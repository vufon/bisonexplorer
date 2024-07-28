import { Controller } from '@hotwired/stimulus'

export default class extends Controller {
  static get targets () {
    return ['tiles', 'ticketTiles', 'yearTile', 'weekTile']
  }

  connect () {
    const targetTimeStr = this.data.get('targetTime')
    const ticketTimeStr = this.data.get('ticketTime')
    this.chainType = this.data.get('chainType')
    if (!targetTimeStr) {
      return
    }
    this.targetDate = parseInt(targetTimeStr)
    this.runTargetCountDown()
    if (this.chainType === 'dcr') {
      this.ticketTime = parseInt(ticketTimeStr)
      this.runTicketTargetCountDown()
    }
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

    // years handler
    this.years = null
    const numOfYears = parseInt(secondsLeft / 31536000)
    if (numOfYears > 0) {
      this.years = this.pad(numOfYears)
      secondsLeft = secondsLeft % 31536000
    }

    // week handler
    this.weeks = null
    const numOfWeek = parseInt(secondsLeft / 604800)
    if (numOfWeek > 0) {
      this.weeks = this.pad(numOfWeek)
      secondsLeft = secondsLeft % 604800
    }

    // days handler
    this.days = this.pad(parseInt(secondsLeft / 86400))
    secondsLeft = secondsLeft % 86400

    // hours handler
    this.hours = this.pad(parseInt(secondsLeft / 3600))
    secondsLeft = secondsLeft % 3600

    // minutes handler
    this.minutes = this.pad(parseInt(secondsLeft / 60))
    // seconds handler
    this.seconds = this.pad(parseInt(secondsLeft % 60))

    // format countdown string + set tag value
    let tileHtml = ''
    if (this.years !== null) {
      this.yearTileTarget.classList.remove('d-hide')
      tileHtml += '<span>' + this.years + '</span>'
    } else {
      this.yearTileTarget.classList.add('d-hide')
    }
    if (this.weeks !== null) {
      this.weekTileTarget.classList.remove('d-hide')
      tileHtml += '<span>' + this.weeks + '</span>'
    } else {
      this.weekTileTarget.classList.add('d-hide')
    }
    tileHtml += '<span>' + this.days + '</span><span>' + this.hours + '</span><span>' + this.minutes + '</span><span>' + this.seconds + '</span>'
    this.tilesTarget.innerHTML = tileHtml
  }
}
