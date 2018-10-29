import { Constants, PayloadTypes } from '../constants'
import { fbMessenger, MessageType } from '../types'
import db from '../manage/db'
import { ReplyMessage } from '../../lib'
import { Report } from '../modules'
import { UserModel, MessageModel, ReportModel } from '../manage/model'
export default class eventReport {
  private step: string
  private app: fbMessenger
  private userId: string
  constructor(step: string) {
    this.step = step
  }

  on = async (app: fbMessenger, userId: string, message: MessageType) => {
    this.app = app
    this.userId = userId
    const { step } = this

    const {
      CANCEL,
      STEP_PICTURES,
      STEP_ANONYMOUS,
      STEP_REPORT_TEXT,
      STEP_CONFIRM,
    } = Constants
    const isText = message.isText()
    if (isText) {
      const text = message.getText()
      if (step === CANCEL) return await this.cancel()
      if (step === STEP_REPORT_TEXT) return await this.stepReportText(text)
      if (step === STEP_PICTURES) return await this.stepTextPictures(text)
      if (step === STEP_ANONYMOUS) return await this.stepAnnonymous(text)
      if (step === STEP_CONFIRM) return await this.stepConfirm(text)
    }
    const attachments = message.getAttachments()
    if (step === STEP_PICTURES) return await this.stepPictures(attachments)
  }

  private stepReportText = async text => {
    const { app, userId } = this
    const { REPLY_ISPICTURES, STEP_PICTURES } = Constants
    const { REPLY_PICTURES_YES, REPLY_PICTURES_NO } = PayloadTypes
    const replyIsPictures = new ReplyMessage(REPLY_ISPICTURES)
    replyIsPictures.addText('예', REPLY_PICTURES_YES)
    replyIsPictures.addText('아니요', REPLY_PICTURES_NO)

    await db.hsetAsync(userId, 'reportText', text)
    await db.hsetAsync(userId, 'step', STEP_PICTURES)
    await app.sendReply(userId, replyIsPictures.buildReply())
    await MessageModel.saveMessage({ userId, text })
  }

  private stepPictures = async attachments => {
    const { app, userId } = this
    const {
      SEND_DISALLOW_FILE,
      SEND_REPORT_CANCEL,
      REPLY_ISANONYMOUS,
    } = Constants
    const { REPLY_ANONYMOUS_YES, REPLY_ANONYMOUS_NO } = PayloadTypes
    attachments.forEach(async attachment => {
      const {
        type,
        payload: { url: imageUrl },
      } = attachment
      if (type !== 'image') {
        await app.sendTextMessage(userId, SEND_DISALLOW_FILE)
        await app.sendTextMessage(userId, SEND_REPORT_CANCEL)
        return await db.delAsync([userId, userId + 'pic'])
      }
      await db.lpushAsync(userId + 'pic', imageUrl)
      await MessageModel.saveMessage({ userId, imageUrl })
    })

    const replyIsAnonymous = new ReplyMessage(REPLY_ISANONYMOUS)
    replyIsAnonymous.addText('예', REPLY_ANONYMOUS_YES)
    replyIsAnonymous.addText('아니요', REPLY_ANONYMOUS_NO)

    await app.sendReply(userId, replyIsAnonymous.buildReply())
  }

  private stepTextPictures = async text => {
    const { app, userId } = this
    const {
      YES,
      PLZ_SEND_PICTURES,
      REPLY_ISANONYMOUS,
      STEP_ANONYMOUS,
      NO,
      PLZ_SEND_CORRECT,
    } = Constants
    const { REPLY_ANONYMOUS_YES, REPLY_ANONYMOUS_NO } = PayloadTypes
    if (text === YES) await app.sendTextMessage(userId, PLZ_SEND_PICTURES)
    if (text === NO) {
      const replyIsAnonymous = new ReplyMessage(REPLY_ISANONYMOUS)
      replyIsAnonymous.addText('예', REPLY_ANONYMOUS_YES)
      replyIsAnonymous.addText('아니요', REPLY_ANONYMOUS_NO)

      await app.sendReply(userId, replyIsAnonymous.buildReply())
      await db.hsetAsync(userId, 'step', STEP_ANONYMOUS)
    }

    if (text !== YES && text !== NO) {
      await app.sendTextMessage(userId, PLZ_SEND_CORRECT)
    }
    await MessageModel.saveMessage({ userId, text })
  }

  private stepAnnonymous = async text => {
    const { app, userId } = this
    const {
      PLZ_SEND_CORRECT,
      REPLY_REPORT_CONFIRM,
      STEP_CONFIRM,
      YES,
      NO,
    } = Constants
    const { REPLY_REPORT_YES, REPLY_REPORT_NO } = PayloadTypes

    if (text === YES) {
      const replyIsConfirm = new ReplyMessage(REPLY_REPORT_CONFIRM)
      replyIsConfirm.addText('예', REPLY_REPORT_YES)
      replyIsConfirm.addText('아니요', REPLY_REPORT_NO)

      await db.hsetAsync(userId, 'isAnonymous', true)
      await db.hsetAsync(userId, 'step', STEP_CONFIRM)
      await app.sendReply(userId, replyIsConfirm.buildReply())
    }

    if (text === NO) {
      const replyIsConfirm = new ReplyMessage(REPLY_REPORT_CONFIRM)
      replyIsConfirm.addText('예', REPLY_REPORT_YES)
      replyIsConfirm.addText('아니요', REPLY_REPORT_NO)

      await db.hsetAsync(userId, 'isAnonymous', false)
      await db.hsetAsync(userId, 'step', STEP_CONFIRM)
      await app.sendReply(userId, replyIsConfirm.buildReply())
    }

    if (text !== YES && text !== NO) {
      await app.sendTextMessage(userId, PLZ_SEND_CORRECT)
    }
    await MessageModel.saveMessage({ userId, text })
  }
  private cancel = async () => {
    const { app, userId } = this
    const { SEND_REPORT_CANCEL } = Constants
    await app.sendTextMessage(userId, SEND_REPORT_CANCEL)
    await db.delAsync([userId, userId + 'pic'])
  }

  private stepConfirm = async text => {
    const { app, userId } = this
    const { SEND_REPORT_NO, YES, NO, PLZ_SEND_CORRECT } = Constants
    if (text === YES) {
      const { name: userName } = await app.getUserProfile(userId)
      const { pageToken, version, endpoint } = app.getAppInfo()
      const { reportText, isAnonymous } = await db.hgetAllAsync(userId)
      const pictures = await db.lrangeAsync(userId + 'pic', 0, -1)
      const report = new Report({
        userId,
        userName,
        isAnonymous,
        reportText,
        pictures,
        pageToken,
        version,
        endpoint,
      })
      const { result, id } = await report.postReport(reportText)
      if (result) {
        await app.sendTextMessage(userId, Constants.SEND_REPORT_SUCCESS)
        await app.sendTextMessage(
          userId,
          `익명 여부 : ${
            Boolean(isAnonymous) ? '예' : '아니요'
          }\n제보 글 : ${reportText}\n${pictures}`
        )
        await app.sendTextMessage(
          userId,
          `작성한 게시글로 이동하기 : https://www.facebook.com/${id}`
        )
        await ReportModel.saveReport({
          userId,
          isAnonymous,
          reportText,
          pictures,
        })
        await UserModel.addReportCount(userId)
      } else {
        await app.sendTextMessage(userId, Constants.SEND_REPORT_FAIL)
      }
      await db.delAsync([userId, userId + 'pic'])
    }

    if (text === NO) {
      await app.sendTextMessage(userId, SEND_REPORT_NO)
      await db.delAsync([userId, userId + 'pic'])
    }

    if (text !== YES && text !== NO) {
      await app.sendTextMessage(userId, PLZ_SEND_CORRECT)
    }
    await MessageModel.saveMessage({ userId, text })
  }
}