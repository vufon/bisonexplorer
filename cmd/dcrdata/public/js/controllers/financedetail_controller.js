import { Controller } from '@hotwired/stimulus'
import TurboQuery from '../helpers/turbolinks_helper'
import { requestJSON } from '../helpers/http'
import humanize from '../helpers/humanize_helper'

const responseCache = {}
let requestCounter = 0
let domainList
let tokenList
let ownerList

function hasCache (k) {
  if (!responseCache[k]) return false
  const expiration = new Date(responseCache[k].expiration)
  return expiration > new Date()
}

export default class extends Controller {
  static get targets () {
    return ['noData', 'reportArea', 'timeInfo', 'proposalReport',
      'domainReport', 'legacyReport', 'prevButton',
      'nextButton', 'domainArea', 'proposalArea', 'legacyArea', 'noReport',
      'totalSpan', 'incomeSpan', 'outgoingSpan', 'monthlyArea', 'yearlyArea',
      'monthlyReport', 'yearlyReport', 'summaryArea', 'summaryReport', 'totalSpanRow',
      'treasurySpanRow', 'proposalSpanRow', 'prevBtn', 'nextBtn']
  }

  async initialize () {
    this.query = new TurboQuery()
    this.settings = TurboQuery.nullTemplate([
      'type', 'time', 'token', 'name'
    ])

    this.defaultSettings = {
      type: '',
      time: '',
      token: '',
      name: ''
    }

    this.query.update(this.settings)

    if (!this.settings.type) {
      this.showNoData()
      return
    }

    if (this.settings.type === 'month' || this.settings.type === 'year') {
      if (!this.settings.time) {
        this.showNoData()
        return
      }
    }
    if (this.settings.type === 'domain' || this.settings.type === 'owner') {
      if (!this.settings.name) {
        this.showNoData()
        return
      }
    }
    if (this.settings.type === 'proposal' && !this.settings.token) {
      this.showNoData()
      return
    }
    this.noDataTarget.classList.add('d-none')
    this.reportAreaTarget.classList.remove('d-none')
    if (this.settings.type === 'month' || this.settings.type === 'year') {
      this.yearMonthCalculate()
      return
    }
    this.proposalCalculate()
  }

  showNoData () {
    this.noDataTarget.classList.remove('d-none')
    this.reportAreaTarget.classList.add('d-none')
  }

  updateQueryString () {
    const [query, settings, defaults] = [{}, this.settings, this.defaultSettings]
    for (const k in settings) {
      if (!settings[k] || settings[k].toString() === defaults[k].toString()) continue
      query[k] = settings[k]
    }
    this.query.replace(query)
  }

  updatePrevNextButton () {
    // if not month or year. Then the next and previous buttons will be displayed differently
    if (this.settings.type !== 'month' && this.settings.type !== 'year') {
      return
    }
    if (this.settings.type === 'year') {
      this.prevButtonTarget.innerHTML = (this.settings.time - 1).toString()
      this.nextButtonTarget.innerHTML = (this.settings.time + 1).toString()
    } else if (this.settings.type === 'month') {
      const timeArr = this.settings.time.trim().split('_')
      const year = parseInt(timeArr[0])
      const month = parseInt(timeArr[1])
      let prevMonth = 0
      let nextMonth = 0
      let nextYear = 0
      let prevYear = 0
      if (month === 1) {
        prevYear = year - 1
        nextYear = year
        prevMonth = 12
        nextMonth = month + 1
      } else if (month === 12) {
        prevYear = year
        nextYear = year + 1
        prevMonth = month - 1
        nextMonth = 1
      } else {
        prevYear = year
        nextYear = year
        prevMonth = month - 1
        nextMonth = month + 1
      }
      this.prevButtonTarget.innerHTML = prevYear + '-' + prevMonth
      this.nextButtonTarget.innerHTML = nextYear + '-' + nextMonth
    }
  }

  prevReport (e) {
    let currentValue
    if (this.settings.type === 'domain' || this.settings.type === 'owner') {
      const itemIndex = this.settings.type === 'domain' ? domainList.indexOf(this.settings.name) : ownerList.indexOf(this.settings.name)
      if (itemIndex < 0) {
        return
      }
      this.settings.name = this.settings.type === 'domain' ? domainList[itemIndex - 1] : ownerList[itemIndex - 1]
      currentValue = this.settings.name
    }

    if (this.settings.type === 'proposal') {
      const itemIndex = tokenList.indexOf(this.settings.token)
      if (itemIndex < 0) {
        return
      }
      this.settings.token = tokenList[itemIndex - 1]
      currentValue = this.settings.token
    }

    if (this.settings.type === 'year') {
      this.settings.time = this.settings.time - 1
    } else if (this.settings.type === 'month') {
      const timeArr = this.settings.time.trim().split('_')
      let year = parseInt(timeArr[0])
      let month = parseInt(timeArr[1])
      if (month === 1) {
        year = year - 1
        month = 12
      } else {
        month = month - 1
      }
      this.settings.time = year + '_' + month
    }

    this.updateQueryString()
    if (this.settings.type === 'year' || this.settings.type === 'month') {
      this.yearMonthCalculate()
    }
    if (this.settings.type === 'domain' || this.settings.type === 'proposal' || this.settings.type === 'owner') {
      this.handlerNextPrevButton(this.settings.type, currentValue)
      this.proposalCalculate()
    }
  }

  nextReport (e) {
    let currentValue
    if (this.settings.type === 'domain' || this.settings.type === 'owner') {
      const itemIndex = this.settings.type === 'domain' ? domainList.indexOf(this.settings.name) : ownerList.indexOf(this.settings.name)
      if (itemIndex < 0) {
        return
      }
      this.settings.name = this.settings.type === 'domain' ? domainList[itemIndex + 1] : ownerList[itemIndex + 1]
      currentValue = this.settings.name
    }

    if (this.settings.type === 'proposal') {
      const itemIndex = tokenList.indexOf(this.settings.token)
      if (itemIndex < 0) {
        return
      }
      currentValue = this.settings.token
      this.settings.token = tokenList[itemIndex + 1]
    }
    if (this.settings.type === 'year') {
      this.settings.time = this.settings.time + 1
    } else if (this.settings.type === 'month') {
      const timeArr = this.settings.time.trim().split('_')
      let year = parseInt(timeArr[0])
      let month = parseInt(timeArr[1])
      if (month === 12) {
        year = year + 1
        month = 1
      } else {
        month = month + 1
      }
      this.settings.time = year + '_' + month
    }
    this.updateQueryString()

    if (this.settings.type === 'year' || this.settings.type === 'month') {
      this.yearMonthCalculate()
    }
    if (this.settings.type === 'domain' || this.settings.type === 'proposal' || this.settings.type === 'owner') {
      this.handlerNextPrevButton(this.settings.type, currentValue)
      this.proposalCalculate()
    }
  }

  async proposalCalculate () {
    if (this.settings.type === 'domain') {
      this.timeInfoTarget.textContent = 'Domain: ' + this.settings.name.charAt(0).toUpperCase() + this.settings.name.slice(1)
    } else if (this.settings.type === 'owner') {
      this.timeInfoTarget.textContent = 'Author: ' + this.settings.name
    }
    const url = `/api/finance-report/detail?type=${this.settings.type}&${this.settings.type === 'proposal' ? 'token=' + this.settings.token : 'name=' + this.settings.name}`
    let response
    requestCounter++
    const thisRequest = requestCounter
    if (hasCache(url)) {
      response = responseCache[url]
    } else {
      // response = await axios.get(url)
      response = await requestJSON(url)
      responseCache[url] = response
      if (thisRequest !== requestCounter) {
        // new request was issued while waiting.
        console.log('Response request different')
      }
    }
    if (!response) {
      this.monthlyAreaTarget.classList.add('d-none')
      this.yearlyAreaTarget.classList.add('d-none')
      if (this.settings.type === 'domain') {
        this.summaryAreaTarget.classList.add('d-none')
      }
      return
    }
    this.monthlyAreaTarget.classList.remove('d-none')
    this.yearlyAreaTarget.classList.remove('d-none')
    if (this.settings.type === 'domain' || this.settings.type === 'owner') {
      this.summaryAreaTarget.classList.remove('d-none')
      this.summaryReportTarget.innerHTML = this.createSummaryTable(response)
      this.setDomainGeneralInfo(response, this.settings.type)
      if (this.settings.type === 'domain') {
        domainList = response.domainList
      } else {
        ownerList = response.ownerList
      }
      this.handlerNextPrevButton(this.settings.type === 'domain' ? 'domain' : 'owner', this.settings.name)
    }
    if (this.settings.type === 'proposal') {
      tokenList = response.tokenList
      this.handlerNextPrevButton('proposal', this.settings.token)
      this.timeInfoTarget.textContent = response.proposalInfo ? response.proposalInfo.name : ''
      this.proposalSpanRowTarget.classList.remove('d-none')
      const remainingStr = response.proposalInfo.totalRemaining === 0.0 ? '<p>Status: <span class="fw-600">Finished</span></p>' : `<p>Total Remaining: <span class="fw-600">$${humanize.formatToLocalString(response.proposalInfo.totalRemaining, 2, 2)}</span></p>`
      this.proposalSpanRowTarget.innerHTML = '<p class="fs-20 mt-3 fw-600">Proposal Infomation</p>' +
      `<p>Start Date: <span class="fw-600">${response.proposalInfo.start}</span></p>` +
      `<p>End Date: <span class="fw-600">${response.proposalInfo.end}</span></p>` +
      `<p>Budget: <span class="fw-600">$${humanize.formatToLocalString(response.proposalInfo.budget, 2, 2)}</span></p>` +
      `<p>Total Spent (Est): <span class="fw-600">$${humanize.formatToLocalString(response.proposalInfo.totalSpent, 2, 2)}</span></p>` + remainingStr
    }
    // Create info of
    // create monthly table
    this.monthlyReportTarget.innerHTML = this.createMonthYearTable(response, 'month')
    this.yearlyReportTarget.innerHTML = this.createMonthYearTable(response, 'year')
  }

  setDomainGeneralInfo (data, type) {
    this.proposalSpanRowTarget.classList.remove('d-none')
    let totalBudget = 0; let totalSpent = 0; let totalRemaining = 0
    if (data.proposalInfos && data.proposalInfos.length > 0) {
      data.proposalInfos.forEach((proposal) => {
        totalBudget += proposal.budget
        totalSpent += proposal.totalSpent
        totalRemaining += proposal.totalRemaining
      })
    }
    this.proposalSpanRowTarget.innerHTML = '<p class="fs-20 mt-3 fw-600">Domain Infomation</p>' +
    `<p>Total Budget: <span class="fw-600">$${humanize.formatToLocalString(totalBudget, 2, 2)}</span></p>` +
    `<p>Total ${type === 'owner' ? 'Received: ' : 'Spent: '}<span class="fw-600">$${humanize.formatToLocalString(totalSpent, 2, 2)}</span></p>` +
    `<p>Total Remaining: <span class="fw-600">$${humanize.formatToLocalString(totalRemaining, 2, 2)}</span></p>`
  }

  handlerNextPrevButton (type, currentValue) {
    let handlerList
    if (type === 'domain') {
      handlerList = domainList
    } else if (type === 'proposal') {
      handlerList = tokenList
    } else if (type === 'owner') {
      handlerList = ownerList
    }

    if (!handlerList || handlerList.length < 1) {
      return
    }
    const indexOfNow = handlerList.indexOf(currentValue)
    if (indexOfNow < 0) {
      return
    }
    if (indexOfNow === 0) {
      // disable left array button
      this.prevBtnTarget.disabled = true
    } else {
      this.prevBtnTarget.disabled = false
    }
    if (indexOfNow === handlerList.length - 1) {
      this.nextBtnTarget.disabled = true
    } else {
      this.nextBtnTarget.disabled = false
    }
  }

  createSummaryTable (data) {
    if (!data.proposalInfos) {
      return ''
    }
    const thead = '<thead>' +
      '<tr class="text-secondary finance-table-header">' +
      '<th class="text-center ps-0 month-col fw-600 proposal-name-col">Name</th>' +
      '<th class="text-center ps-0 ps-3 pr-3 fw-600">Author</th>' +
      '<th class="text-center ps-0 ps-3 pr-3 fw-600">Start Date</th>' +
      '<th class="text-center ps-0 ps-3 pr-3 fw-600">End Date</th>' +
      '<th class="text-right ps-0 ps-3 pr-3 fw-600">Budget</th>' +
      '<th class="text-right ps-0 ps-3 pr-3 fw-600">Total Spent (Est)</th>' +
      '<th class="text-right ps-0 ps-3 pr-3 fw-600 pr-10i">Total Remaining</th>' +
      '</tr></thead>'
    let tbody = '<tbody>###</tbody>'
    let bodyList = ''
    // create tbody content
    for (let i = 0; i < data.proposalInfos.length; i++) {
      const summary = data.proposalInfos[i]
      bodyList += `<tr${summary.totalRemaining === 0.0 ? '' : ' class="summary-active-row"'}>` +
        `<td class="text-center fs-13i"><a href="${'/finance-report/detail?type=proposal&token=' + summary.token}" class="link-hover-underline fs-13i">${summary.name}</a></td>` +
        `<td class="text-center fs-13i"><a href="${'/finance-report/detail?type=owner&name=' + summary.author}" class="link-hover-underline fs-13i">${summary.author}</a></td>` +
        `<td class="text-center fs-13i">${summary.start}</td>` +
        `<td class="text-center fs-13i">${summary.end}</td>` +
        `<td class="text-right fs-13i">$${humanize.formatToLocalString(summary.budget, 2, 2)}</td>` +
        `<td class="text-right fs-13i">$${humanize.formatToLocalString(summary.totalSpent, 2, 2)}</td>` +
        `<td class="text-right fs-13i pr-10i">$${humanize.formatToLocalString(summary.totalRemaining, 2, 2)}</td>` +
        '</tr>'
    }
    tbody = tbody.replace('###', bodyList)
    return thead + tbody
  }

  getYearDataFromMonthData (data) {
    const result = []
    const yearDataMap = new Map()
    const yearArr = []
    data.monthData.forEach((item) => {
      const monthArr = item.month.split('-')
      if (monthArr.length !== 2) {
        return
      }
      const year = monthArr[0]
      if (!yearArr.includes(year)) {
        yearArr.push(year)
      }
      if (yearDataMap.has(year)) {
        yearDataMap.set(year, yearDataMap.get(year) + item.expense)
      } else {
        yearDataMap.set(year, item.expense)
      }
    })

    yearArr.forEach((year) => {
      const object = {
        month: year,
        expense: yearDataMap.get(year)
      }
      result.push(object)
    })
    return result
  }

  getFullTimeParam (timeInput, splitChar) {
    const timeArr = timeInput.split(splitChar)
    let timeParam = ''
    if (timeArr.length === 2) {
      timeParam = timeArr[0] + '_'
      // if month < 10
      if (timeArr[1].charAt(0) === '0') {
        timeParam += timeArr[1].substring(1, timeArr[1].length)
      } else {
        timeParam += timeArr[1]
      }
    }
    return timeParam
  }

  createMonthYearTable (data, type) {
    let handlerData = data.monthData
    if (type === 'year') {
      handlerData = this.getYearDataFromMonthData(data)
    }
    let allTable = ''
    let count = 0
    for (let i = 0; i < handlerData.length; i++) {
      if (count === 0) {
        allTable += '<table class="table v3 border-grey-2 w-auto" style="height: 40px;">'
        allTable += '<tbody>'
      }
      const dataMonth = handlerData[i]
      allTable += '<tr>'
      // td domain name
      const timeParam = this.getFullTimeParam(dataMonth.month, '-')
      allTable += `<td class="text-left fs-13i"><a class="link-hover-underline fs-13i fw-600" style="text-align: right; width: 80px;" href="${'/finance-report/detail?type=' + type + '&time=' + (timeParam === '' ? dataMonth.month : timeParam)}">${dataMonth.month}</a></td>`
      allTable += `<td class="text-right fs-13i">$${humanize.formatToLocalString(dataMonth.expense, 2, 2)}</td>`
      allTable += '</tr>'
      if (count === 7) {
        allTable += '</tbody>'
        allTable += '</table>'
        count = 0
      } else {
        count++
      }
    }
    if (count !== 7) {
      allTable += '</tbody>'
      allTable += '</table>'
    }
    return allTable
  }

  // Calculate and response
  async yearMonthCalculate () {
    this.updatePrevNextButton()
    this.timeInfoTarget.textContent = 'Detail of: ' + this.settings.time.toString().replace('_', '-')
    const url = `/api/finance-report/detail?type=${this.settings.type}&time=${this.settings.time}`
    let response
    requestCounter++
    const thisRequest = requestCounter
    if (hasCache(url)) {
      response = responseCache[url]
    } else {
      // response = await axios.get(url)
      response = await requestJSON(url)
      responseCache[url] = response
      if (thisRequest !== requestCounter) {
        // new request was issued while waiting.
        console.log('Response request different')
      }
    }

    this.totalSpanRowTarget.classList.remove('d-none')
    this.treasurySpanRowTarget.classList.remove('d-none')

    if (!response) {
      this.proposalAreaTarget.classList.add('d-none')
      this.domainAreaTarget.classList.add('d-none')
      this.legacyAreaTarget.classList.add('d-none')
      this.totalSpanTarget.textContent = '$0'
      this.incomeSpanTarget.textContent = '0 DCR'
      this.outgoingSpanTarget.textContent = '0 DCR'
      return
    }
    this.proposalReportTarget.innerHTML = this.createProposalDetailReport(response)
    this.domainReportTarget.innerHTML = this.createDomainDetailReport(response)
    this.createTreasuryDetailReport(response, true)
    this.legacyReportTarget.innerHTML = this.createTreasuryDetailReport(response, false)
    if (this.proposalAreaTarget.classList.contains('d-none') &&
      this.domainAreaTarget.classList.contains('d-none') &&
      this.legacyAreaTarget.classList.contains('d-none')) {
      this.noReportTarget.classList.remove('d-none')
    } else {
      this.noReportTarget.classList.add('d-none')
    }
  }

  createDomainDetailReport (data) {
    if (!data.reportDetail || data.reportDetail.length === 0) {
      this.domainAreaTarget.classList.add('d-none')
      return ''
    }
    this.domainAreaTarget.classList.remove('d-none')
    const domainMap = new Map()
    data.reportDetail.forEach((detail) => {
      if (domainMap.has(detail.domain)) {
        domainMap.set(detail.domain, domainMap.get(detail.domain) + detail.expense)
      } else {
        domainMap.set(detail.domain, detail.expense)
      }
    })
    let tbody = '<tbody>###</tbody>'

    let bodyList = ''
    for (let i = 0; i < data.domainList.length; i++) {
      const domain = data.domainList[i]
      bodyList += '<tr>'
      // td domain name
      bodyList += `<td class="text-left fs-13i"><a href="${'/finance-report/detail?type=domain&name=' + domain}" class="link-hover-underline fs-13i">${domain.charAt(0).toUpperCase() + domain.slice(1)}</a></td>`
      bodyList += `<td class="text-right fs-13i">$${humanize.formatToLocalString(domainMap.get(domain), 2, 2)}</td>`
      bodyList += '</tr>'
    }
    tbody = tbody.replace('###', bodyList)
    return tbody
  }

  createTreasuryDetailReport (data, isTreasury) {
    const handlerData = isTreasury ? data.treasurySummary : data.legacySummary
    if (handlerData.invalue === 0 && handlerData.outvalue === 0 && handlerData.difference === 0 && handlerData.total === 0) {
      if (isTreasury) {
        this.incomeSpanTarget.textContent = '0 DCR'
        this.outgoingSpanTarget.textContent = '0 DCR'
      } else {
        this.legacyAreaTarget.classList.add('d-none')
      }
      return ''
    }
    const invalue = !isTreasury ? humanize.formatToLocalString((handlerData.invalue / 100000000), 3, 3) : humanize.formatToLocalString((handlerData.invalue / 500000000), 3, 3)
    const outvalue = !isTreasury ? humanize.formatToLocalString((handlerData.outvalue / 100000000), 3, 3) : humanize.formatToLocalString((handlerData.outvalue / 500000000), 3, 3)
    if (isTreasury) {
      this.incomeSpanTarget.textContent = humanize.formatToLocalString((handlerData.invalue / 500000000), 3, 3) + ' DCR'
      this.outgoingSpanTarget.textContent = humanize.formatToLocalString((handlerData.outvalue / 500000000), 3, 3) + ' DCR'
      return ''
    } else {
      this.legacyAreaTarget.classList.remove('d-none')
    }
    let tbody = '<tbody>###</tbody>'
    let bodyList = ''
    const difference = !isTreasury ? humanize.formatToLocalString((handlerData.difference / 100000000), 3, 3) : humanize.formatToLocalString((handlerData.difference / 500000000), 3, 3)
    const total = !isTreasury ? humanize.formatToLocalString((handlerData.total / 100000000), 3, 3) : humanize.formatToLocalString((handlerData.total / 500000000), 3, 3)
    // legacy credit row
    bodyList += '<tr><td class="text-left fs-13i">Credit</td>' +
      `<td class="text-right-i fs-13i treasury-content-cell">${invalue} DCR</td>` +
      `<td class="text-right-i fs-13i treasury-content-cell">~ $${humanize.formatToLocalString((handlerData.invalueUSD), 2, 2)}</td></tr>`
    // legacy spent row
    bodyList += '<tr><td class="text-left fs-13i">Spent</td>' +
    `<td class="text-right-i fs-13i treasury-content-cell">${outvalue} DCR</td>` +
    `<td class="text-right-i fs-13i treasury-content-cell">~ $${humanize.formatToLocalString((handlerData.outvalueUSD), 2, 2)}</td></tr>`
    // Difference row
    bodyList += '<tr><td class="text-left fs-13i">Difference</td>' +
    `<td class="text-right-i fs-13i treasury-content-cell">${difference} DCR</td>` +
    `<td class="text-right-i fs-13i treasury-content-cell">~ $${humanize.formatToLocalString((handlerData.differenceUSD), 2, 2)}</td></tr>`
    // Total row
    bodyList += '<tr><td class="text-left fs-13i">Total</td>' +
    `<td class="text-right-i fs-13i treasury-content-cell">${total} DCR</td>` +
    `<td class="text-right-i fs-13i treasury-content-cell">~ $${humanize.formatToLocalString((handlerData.totalUSD), 2, 2)}</td></tr>`
    tbody = tbody.replace('###', bodyList)
    return tbody
  }

  createProposalDetailReport (data) {
    if (!data.reportDetail || data.reportDetail.length === 0) {
      this.proposalAreaTarget.classList.add('d-none')
      this.totalSpanTarget.textContent = '$0'
      return ''
    }
    this.proposalAreaTarget.classList.remove('d-none')
    let tbody = '<tbody>###</tbody>'
    let bodyList = ''
    for (let i = 0; i < data.reportDetail.length; i++) {
      bodyList += '<tr>'
      const report = data.reportDetail[i]
      // add proposal name
      bodyList += '<td class="text-left fs-13i">'
      bodyList += `<a href="${'/finance-report/detail?type=proposal&token=' + report.token}" class="link-hover-underline fs-13i d-block">${report.name}</a></td>`
      bodyList += '<td class="text-right fs-13i">'
      bodyList += `$${humanize.formatToLocalString(report.expense, 2, 2)}</td>`
      bodyList += '</tr>'
    }
    // set total on top header
    this.totalSpanTarget.textContent = `$${humanize.formatToLocalString(data.proposalTotal, 2, 2)}`
    tbody = tbody.replace('###', bodyList)
    return tbody
  }
}
