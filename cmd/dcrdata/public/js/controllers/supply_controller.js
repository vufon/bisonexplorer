import { Controller } from '@hotwired/stimulus'

export default class extends Controller {
  static get targets () {
    return ['tiles', 'ticketTiles']
  }

  connect () {
    const targetTimeStr = this.data.get('targetTime')
    const ticketTimeStr = this.data.get('ticketTime')
    if (!targetTimeStr) {
      return
    }
    this.targetDate = parseInt(targetTimeStr)
    this.ticketTime = parseInt(ticketTimeStr)
    this.runTargetCountDown()
    this.runTicketTargetCountDown()
  }

  runTargetCountDown () {
    this.getCountdown()
    const _this = this
    setInterval(function () { _this.getCountdown() }, 1000)
  }

  runTicketTargetCountDown () {
    this.getTicketCountdown()
    const _this = this
    setInterval(function () { _this.getTicketCountdown() }, 1000)
  }

  pad (n) {
    return (n < 10 ? '0' : '') + n
  }

  getTicketCountdown () {
    const currentDate = new Date().getTime()
    let secondsLeft = this.ticketTime - currentDate / 1000
    this.ticketDays = this.pad(parseInt(secondsLeft / 86400))
    secondsLeft = secondsLeft % 86400

    this.ticketHours = this.pad(parseInt(secondsLeft / 3600))
    secondsLeft = secondsLeft % 3600

    this.ticketMinutes = this.pad(parseInt(secondsLeft / 60))
    this.ticketSeconds = this.pad(parseInt(secondsLeft % 60))

    // format countdown string + set tag value
    this.ticketTilesTarget.innerHTML = '<span>' + this.ticketDays + '</span><span>' + this.ticketHours + '</span><span>' + this.ticketMinutes + '</span><span>' + this.ticketSeconds + '</span>'
  }

  getCountdown () {
    const currentDate = new Date().getTime()
    let secondsLeft = this.targetDate - currentDate / 1000
    this.days = this.pad(parseInt(secondsLeft / 86400))
    secondsLeft = secondsLeft % 86400

    this.hours = this.pad(parseInt(secondsLeft / 3600))
    secondsLeft = secondsLeft % 3600

    this.minutes = this.pad(parseInt(secondsLeft / 60))
    this.seconds = this.pad(parseInt(secondsLeft % 60))

    // format countdown string + set tag value
    this.tilesTarget.innerHTML = '<span>' + this.days + '</span><span>' + this.hours + '</span><span>' + this.minutes + '</span><span>' + this.seconds + '</span>'
  }
}
