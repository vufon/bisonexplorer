import { Controller } from '@hotwired/stimulus'
import TurboQuery from '../helpers/turbolinks_helper'
import { requestJSON } from '../helpers/http'
import humanize from '../helpers/humanize_helper'

const responseCache = {}
let requestCounter = 0
let responseData
let proposalResponse = null
let treasuryResponse = null
let legacyResponse = null

const proposalNote = '<br /><span class="fs-15">*The data is the daily cost estimate based on the total budget divided by the total number of proposals days</span>'
const treasuryNote = '<br /><span class="fs-15">*Data is summed by month</span>'

const proposalTitle = 'Finance Report - Proposals Data' + proposalNote
const summaryTitle = 'Finance Report - Proposal Summary' + proposalNote
const domainTitle = 'Finance Report - Domain Stats' + proposalNote
const treasuryTitle = 'Finance Report - Treasury Stats' + treasuryNote

function hasCache (k) {
  if (!responseCache[k]) return false
  const expiration = new Date(responseCache[k].expiration)
  return expiration > new Date()
}

export default class extends Controller {
  static get targets () {
    return ['type', 'report', 'reportTitle', 'colorNoteRow', 'colorLabel', 'colorDescription', 'legacySwitch', 'interval', 'groupBy']
  }

  async initialize () {
    this.query = new TurboQuery()
    this.settings = TurboQuery.nullTemplate([
      'type', 'tsort', 'psort', 'legacy', 'interval'
    ])

    this.defaultSettings = {
      type: 'proposal',
      tsort: 'oldest',
      psort: 'newest',
      legacy: false,
      interval: 'month'
    }

    this.query.update(this.settings)
    if (!this.settings.type) {
      this.settings.type = this.defaultSettings.type
    }
    if (!this.settings.interval) {
      this.settings.interval = this.defaultSettings.interval
    }
    this.typeTargets.forEach((typeTarget) => {
      typeTarget.classList.remove('btn-active')
      if (typeTarget.name === this.settings.type) {
        typeTarget.classList.add('btn-active')
      }
    })
    this.intervalTargets.forEach((intervalTarget) => {
      intervalTarget.classList.remove('btn-active')
      if (intervalTarget.name === this.settings.interval) {
        intervalTarget.classList.add('btn-active')
      }
    })
    this.setReportTitle(this.settings.type)
    this.calculate()
  }

  updateQueryString () {
    const [query, settings, defaults] = [{}, this.settings, this.defaultSettings]
    for (const k in settings) {
      if (!settings[k] || settings[k].toString() === defaults[k].toString()) continue
      query[k] = settings[k]
    }
    this.query.replace(query)
  }

  setReportTitle (type) {
    switch (type) {
      case 'proposal':
        this.reportTitleTarget.innerHTML = proposalTitle
        break
      case 'summary':
        this.reportTitleTarget.innerHTML = summaryTitle
        break
      case 'domain':
        this.reportTitleTarget.innerHTML = domainTitle
        break
      case 'treasury':
        this.reportTitleTarget.innerHTML = treasuryTitle
    }
  }

  intervalChange (e) {
    if (e.target.name === this.settings.interval) {
      return
    }
    const target = e.srcElement || e.target
    this.intervalTargets.forEach((intervalTarget) => {
      intervalTarget.classList.remove('btn-active')
    })
    target.classList.add('btn-active')
    this.settings.interval = e.target.name
    this.calculate()
  }

  typeChange (e) {
    if (e.target.name === this.settings.type) {
      return
    }
    const target = e.srcElement || e.target
    this.typeTargets.forEach((typeTarget) => {
      typeTarget.classList.remove('btn-active')
    })
    target.classList.add('btn-active')
    this.settings.type = e.target.name
    this.setReportTitle(e.target.name)
    this.calculate()
  }

  getApiUrlByType () {
    switch (this.settings.type) {
      case 'treasury':
        return `/api/finance-report/treasury?legacy=${this.settings.legacy}`
      case 'proposal':
        return `/api/finance-report/proposal?psort=${this.settings.psort}&tsort=${this.settings.tsort}`
      default:
        return '/api/finance-report/proposal'
    }
  }

  createReportTable () {
    this.updateQueryString()
    if (this.settings.type === 'proposal') {
      this.colorNoteRowTarget.classList.remove('d-none')
      this.colorLabelTarget.classList.remove('summary-note-color')
      this.colorLabelTarget.classList.add('proposal-note-color')
      this.colorDescriptionTarget.textContent = 'Valid payment month'
    } else if (this.settings.type === 'summary') {
      this.colorNoteRowTarget.classList.remove('d-none')
      this.colorLabelTarget.classList.remove('proposal-note-color')
      this.colorLabelTarget.classList.add('summary-note-color')
      this.colorDescriptionTarget.textContent = 'The proposals are still active'
    } else {
      this.colorNoteRowTarget.classList.add('d-none')
    }
    if (this.settings.type === 'domain' || (this.settings.type === 'proposal' && this.settings.interval === 'year')) {
      this.reportTarget.classList.add('domain-group-report')
    } else {
      this.reportTarget.classList.remove('domain-group-report')
    }

    if (this.settings.type === 'treasury') {
      this.reportTarget.classList.add('treasury-group-report')
    } else {
      this.reportTarget.classList.remove('treasury-group-report')
    }

    if (this.settings.type === 'treasury') {
      this.legacySwitchTarget.classList.remove('d-none')
      document.getElementById('legacyLabel').classList.remove('d-none')
      if (!this.settings.legacy || this.settings.legacy === 'false') {
        document.getElementById('legacySwitchInput').checked = false
        document.getElementById('legacyLabel').textContent = 'Treasury Report'
      } else {
        document.getElementById('legacySwitchInput').checked = true
        document.getElementById('legacyLabel').textContent = 'Legacy Report'
      }
    } else {
      this.legacySwitchTarget.classList.add('d-none')
      document.getElementById('legacyLabel').classList.add('d-none')
    }

    if (this.settings.type === 'summary') {
      this.reportTarget.classList.add('summary-group-report')
      this.groupByTarget.classList.add('d-none')
    } else {
      this.reportTarget.classList.remove('summary-group-report')
      this.groupByTarget.classList.remove('d-none')
    }
    this.reportTarget.innerHTML = this.createTableContent()
  }

  createTableContent () {
    switch (this.settings.type) {
      case 'summary':
        return this.createSummaryTable(responseData)
      case 'domain':
        return this.createDomainTable(responseData)
      case 'treasury':
        return this.createTreasuryTable(responseData)
      default:
        return this.createProposalTable(responseData)
    }
  }

  sortVertical () {
    this.settings.tsort = (this.settings.tsort === 'oldest' || !this.settings.tsort || this.settings.tsort === '') ? 'newest' : 'oldest'
    this.createReportTable()
  }

  sortHorizontal () {
    this.settings.psort = (this.settings.psort === 'newest' || !this.settings.psort || this.settings.psort === '') ? 'oldest' : 'newest'
    this.createReportTable()
  }

  getTreasuryYearlyData (data) {
    const dataMap = new Map()
    const yearArr = []
    for (let i = 0; i < data.treasurySummary.length; i++) {
      const item = data.treasurySummary[i]
      const month = item.month
      if (month && month !== '') {
        const year = month.split('-')[0]
        if (!yearArr.includes(year)) {
          yearArr.push(year)
        }
        let monthObj = {}
        if (dataMap.has(year)) {
          monthObj = dataMap.get(year)
          monthObj.invalue += item.invalue
          monthObj.invalueUSD += item.invalueUSD
          monthObj.outvalue += item.outvalue
          monthObj.outvalueUSD += item.outvalueUSD
          monthObj.difference += item.difference
          monthObj.differenceUSD += item.differenceUSD
          monthObj.total += item.total
          monthObj.totalUSD += item.totalUSD
        } else {
          monthObj.month = year
          monthObj.invalue = item.invalue
          monthObj.invalueUSD = item.invalueUSD
          monthObj.outvalue = item.outvalue
          monthObj.outvalueUSD = item.outvalueUSD
          monthObj.difference = item.difference
          monthObj.differenceUSD = item.differenceUSD
          monthObj.total = item.total
          monthObj.totalUSD = item.totalUSD
        }
        dataMap.set(year, monthObj)
      }
    }
    const result = []
    yearArr.forEach((year) => {
      result.push(dataMap.get(year))
    })
    const mapResult = {}
    mapResult.treasurySummary = result
    return mapResult
  }

  getProposalYearlyData (data) {
    const result = {}
    result.allSpent = data.allSpent
    result.allBudget = data.allBudget
    result.proposalList = data.proposalList
    result.domainList = data.domainList
    result.summary = data.summary

    const dataMap = new Map()
    const yearArr = []
    data.report.forEach((report) => {
      const month = report.month
      if (month && month !== '') {
        const year = month.split('/')[0]
        if (!yearArr.includes(year)) {
          yearArr.push(year)
        }
        let monthObj = {}
        if (dataMap.has(year)) {
          monthObj = dataMap.get(year)
          monthObj.total += report.total
          for (let i = 0; i < monthObj.allData.length; i++) {
            monthObj.allData[i].expense += report.allData[i].expense
          }
          for (let i = 0; i < monthObj.domainData.length; i++) {
            monthObj.domainData[i].expense += report.domainData[i].expense
          }
        } else {
          monthObj.total = report.total
          monthObj.month = year
          monthObj.allData = []
          monthObj.domainData = []
          for (let i = 0; i < report.allData.length; i++) {
            const item = report.allData[i]
            const allDataItem = {}
            allDataItem.token = item.token
            allDataItem.name = item.name
            allDataItem.expense = item.expense
            allDataItem.domain = item.domain
            monthObj.allData.push(allDataItem)
          }
          for (let i = 0; i < report.domainData.length; i++) {
            const item = report.domainData[i]
            const domainDataItem = {}
            domainDataItem.domain = item.domain
            domainDataItem.expense = item.expense
            monthObj.domainData.push(domainDataItem)
          }
          dataMap.set(year, monthObj)
        }
      }
    })
    result.report = []
    yearArr.forEach((year) => {
      result.report.push(dataMap.get(year))
    })
    return result
  }

  createProposalTable (data) {
    if (!data.report) {
      return ''
    }
    let handlerData = data
    if (this.settings.interval === 'year') {
      handlerData = this.getProposalYearlyData(data)
    }
    let thead = '<thead><tr class="text-secondary finance-table-header">' +
      '<th class="text-center ps-0 month-col border-right-grey report-first-header head-first-cell">' +
      '<div class="c1"><span data-action="click->financereport#sortHorizontal" class="homeicon-swap vertical-sort"></span></div><div class="c2"><span data-action="click->financereport#sortVertical" class="homeicon-swap horizontal-sort"></span></div></th>' +
      '###' +
      '<th class="text-right ps-0 fw-600 month-col ta-center border-left-grey report-last-header">Total</th>' +
      '</tr></thead>'
    let tbody = '<tbody>###</tbody>'

    let headList = ''
    for (let i = 0; i < handlerData.report.length; i++) {
      const index = this.settings.tsort === 'newest' ? i : (handlerData.report.length - i - 1)
      const report = handlerData.report[index]
      headList += '<th class="text-right fw-600 pb-30i fs-13i ps-3 pr-3 table-header-sticky proposal-header-th" ' +
      `id="${this.settings.interval + ';' + report.month}" data-action="click->financereport#proposalReportTimeDetail">` +
      `<span class="d-block pr-5">${report.month.replace('/', '-')}</span></th>`
    }
    thead = thead.replace('###', headList)

    let bodyList = ''
    for (let i = 0; i < handlerData.proposalList.length; i++) {
      const index = this.settings.psort === 'oldest' ? (handlerData.proposalList.length - i - 1) : i
      const proposal = handlerData.proposalList[index]
      bodyList += `<tr><td class="text-center fs-13i border-right-grey report-first-data"><span class="d-block proposal-title-col">${proposal}</span></td>`
      for (let j = 0; j < handlerData.report.length; j++) {
        const tindex = this.settings.tsort === 'newest' ? j : (handlerData.report.length - j - 1)
        const report = handlerData.report[tindex]
        const allData = report.allData[index]
        if (allData.expense > 0) {
          bodyList += '<td class="text-right fs-13i proposal-content-td">'
          bodyList += `$${humanize.formatToLocalString(allData.expense, 2, 2)}`
        } else {
          bodyList += '<td class="text-center fs-13i">'
        }
        bodyList += '</td>'
      }
      bodyList += `<td class="text-right fs-13i fw-600 border-left-grey report-last-data">$${humanize.formatToLocalString(handlerData.summary[index].totalSpent, 2, 2)}</td></tr>`
    }

    bodyList += '<tr class="finance-table-header">' +
      '<td class="text-center fw-600 fs-13i report-first-header">Total</td>'
    for (let i = 0; i < handlerData.report.length; i++) {
      const index = this.settings.tsort === 'newest' ? i : (handlerData.report.length - i - 1)
      const report = handlerData.report[index]
      bodyList += `<td class="text-right fw-600 fs-13i">$${humanize.formatToLocalString(report.total, 2, 2)}</td>`
    }

    bodyList += `<td class="text-right fw-600 fs-13i report-last-header">$${humanize.formatToLocalString(handlerData.allSpent, 2, 2)}</td></tr>`

    tbody = tbody.replace('###', bodyList)
    return thead + tbody
  }

  createSummaryTable (data) {
    if (!data.report) {
      return ''
    }
    const thead = '<thead>' +
      '<tr class="text-secondary finance-table-header">' +
      '<th class="text-center ps-0 month-col fw-600 proposal-name-col">Name</th>' +
      '<th class="text-center ps-0 ps-3 pr-3 fw-600">Start Date' +
      `<span data-action="click->financereport#sortHorizontal" class="${this.settings.psort === 'newest' ? 'dcricon-arrow-down' : 'dcricon-arrow-up'} col-sort ms-1"></span></th>` +
      '<th class="text-center ps-0 ps-3 pr-3 fw-600">End Date</th>' +
      '<th class="text-right ps-0 ps-3 pr-3 fw-600">Budget</th>' +
      '<th class="text-right ps-0 ps-3 pr-3 fw-600">Total Spent (Est)</th>' +
      '<th class="text-right ps-0 ps-3 pr-3 fw-600 pr-10i">Total Remaining</th>' +
      '</tr></thead>'
    let tbody = '<tbody>###</tbody>'
    let bodyList = ''
    // create tbody content
    for (let i = 0; i < data.summary.length; i++) {
      const index = this.settings.psort === 'newest' ? i : (data.summary.length - i - 1)
      const summary = data.summary[index]
      bodyList += `<tr${summary.totalRemaining === 0.0 ? '' : ' class="summary-active-row"'}>` +
        `<td class="text-center fs-13i">${summary.name}</td>` +
        `<td class="text-center fs-13i">${summary.start}</td>` +
        `<td class="text-center fs-13i">${summary.end}</td>` +
        `<td class="text-right fs-13i">$${humanize.formatToLocalString(summary.budget, 2, 2)}</td>` +
        `<td class="text-right fs-13i">$${humanize.formatToLocalString(summary.totalSpent, 2, 2)}</td>` +
        `<td class="text-right fs-13i pr-10i">$${humanize.formatToLocalString(summary.totalRemaining, 2, 2)}</td>` +
        '</tr>'
    }

    bodyList += '<tr class="finance-table-header">' +
      '<td class="text-center fw-600 fs-15i" colspan="3">Total</td>' +
      `<td class="text-right fw-600 fs-15i">$${humanize.formatToLocalString(data.allBudget, 2, 2)}</td>` +
      `<td class="text-right fw-600 fs-15i">$${humanize.formatToLocalString(data.allSpent, 2, 2)}</td>` +
      `<td class="text-right fw-600 fs-15i pr-10i">$${humanize.formatToLocalString(data.allBudget - data.allSpent, 2, 2)}</td>` +
      '</tr>'

    tbody = tbody.replace('###', bodyList)
    return thead + tbody
  }

  createDomainTable (data) {
    if (!data.report) {
      return ''
    }
    let handlerData = data
    if (this.settings.interval === 'year') {
      handlerData = this.getProposalYearlyData(data)
    }
    let thead = '<thead><tr class="text-secondary finance-table-header">' +
      `<th class="text-center ps-0 month-col border-right-grey"><span data-action="click->financereport#sortVertical" class="${this.settings.tsort === 'newest' ? 'dcricon-arrow-down' : 'dcricon-arrow-up'} col-sort"></span></th>` +
      '###' +
      '<th class="text-right ps-0 fw-600 month-col ta-center border-left-grey">Total</th>' +
      '</tr></thead>'
    let tbody = '<tbody>###</tbody>'

    let headList = ''
    handlerData.domainList.forEach((domain) => {
      headList += `<th class="text-right-i domain-content-cell ps-0 fs-13i ps-3 pr-3 fw-600 proposal-header-th">${domain.charAt(0).toUpperCase() + domain.slice(1)}</th>`
    })
    thead = thead.replace('###', headList)

    let bodyList = ''
    // create tbody content
    for (let i = 0; i < handlerData.report.length; i++) {
      const index = this.settings.tsort === 'newest' ? i : (handlerData.report.length - i - 1)
      const report = handlerData.report[index]
      bodyList += `<tr><td class="text-center fs-13i fw-600 border-right-grey">${report.month.replace('/', '-')}</td>`
      report.domainData.forEach((domainData) => {
        bodyList += `<td class="text-right-i domain-content-cell fs-13i">$${humanize.formatToLocalString(domainData.expense, 2, 2)}</td>`
      })
      bodyList += `<td class="text-right fs-13i fw-600 border-left-grey">${humanize.formatToLocalString(report.total, 2, 2)}</td></tr>`
    }

    tbody = tbody.replace('###', bodyList)
    return thead + tbody
  }

  createTreasuryTable (data) {
    if (!data.treasurySummary) {
      return ''
    }
    let handlerData = data
    if (this.settings.interval === 'year') {
      handlerData = this.getTreasuryYearlyData(data)
    }
    const thead = '<thead>' +
      '<tr class="text-secondary finance-table-header">' +
      `<th class="text-center ps-0 month-col border-right-grey"><span data-action="click->financereport#sortVertical" class="${this.settings.tsort === 'newest' ? 'dcricon-arrow-down' : 'dcricon-arrow-up'} col-sort"></span></th>` +
      `<th class="text-right-i ps-0 fs-13i ps-3 pr-3 fw-600 treasury-content-cell">${this.settings.legacy ? 'Credit' : 'Incoming'} (DCR)</th>` +
      `<th class="text-right-i ps-0 fs-13i ps-3 pr-3 fw-600 treasury-content-cell">${this.settings.legacy ? 'Credit' : 'Incoming'} (USD)</th>` +
      `<th class="text-right-i ps-0 fs-13i ps-3 pr-3 fw-600 treasury-content-cell">${this.settings.legacy ? 'Spent' : 'Outgoing'} (DCR)</th>` +
      `<th class="text-right-i ps-0 fs-13i ps-3 pr-3 fw-600 treasury-content-cell">${this.settings.legacy ? 'Spent' : 'Outgoing'} (USD)</th>` +
      '<th class="text-right-i ps-0 fs-13i ps-3 pr-3 fw-600 treasury-content-cell">Difference (DCR)</th>' +
      '<th class="text-right-i ps-0 fs-13i ps-3 pr-3 fw-600 treasury-content-cell">Difference (USD)</th>' +
      '<th class="text-right-i ps-0 fs-13i ps-3 pr-3 fw-600 treasury-content-cell">Total (DCR)</th>' +
      '<th class="text-right-i ps-0 fs-13i ps-3 pr-3 fw-600 treasury-content-cell">Total (USD)</th>' +
      '</tr></thead>'
    let tbody = '<tbody>###</tbody>'
    let bodyList = ''
    // create tbody content
    for (let i = 0; i < handlerData.treasurySummary.length; i++) {
      const index = this.settings.tsort === 'newest' ? i : (handlerData.treasurySummary.length - i - 1)
      const treasury = handlerData.treasurySummary[index]
      const invalue = this.settings.legacy ? humanize.formatToLocalString((treasury.invalue / 100000000), 3, 3) : humanize.formatToLocalString((treasury.invalue / 500000000), 3, 3)
      const outvalue = this.settings.legacy ? humanize.formatToLocalString((treasury.outvalue / 100000000), 3, 3) : humanize.formatToLocalString((treasury.outvalue / 500000000), 3, 3)
      const difference = this.settings.legacy ? humanize.formatToLocalString((treasury.difference / 100000000), 3, 3) : humanize.formatToLocalString((treasury.difference / 500000000), 3, 3)
      const total = this.settings.legacy ? humanize.formatToLocalString((treasury.total / 100000000), 3, 3) : humanize.formatToLocalString((treasury.total / 500000000), 3, 3)
      bodyList += '<tr>' +
        `<td class="text-center fs-13i fw-600 border-right-grey">${treasury.month}</td>` +
        `<td class="text-right-i fs-13i treasury-content-cell">${invalue}</td>` +
        `<td class="text-right-i fs-13i treasury-content-cell">$${humanize.formatToLocalString((treasury.invalueUSD), 2, 2)}</td>` +
        `<td class="text-right-i fs-13i treasury-content-cell">${outvalue}</td>` +
        `<td class="text-right-i fs-13i treasury-content-cell">$${humanize.formatToLocalString((treasury.outvalueUSD), 2, 2)}</td>` +
        `<td class="text-right-i fs-13i treasury-content-cell">${difference}</td>` +
        `<td class="text-right-i fs-13i treasury-content-cell">$${humanize.formatToLocalString((treasury.differenceUSD), 2, 2)}</td>` +
        `<td class="text-right-i fs-13i treasury-content-cell">${total}</td>` +
        `<td class="text-right-i fs-13i treasury-content-cell">$${humanize.formatToLocalString((treasury.totalUSD), 2, 2)}</td>` +
        '</tr>'
    }
    tbody = tbody.replace('###', bodyList)
    return thead + tbody
  }

  // Calculate and response
  async calculate () {
    // if got report. ignore get by api
    let haveResponseData
    if (this.settings.type === 'treasury') {
      console.log('legacy: type ' + typeof this.settings.legacy + ' : value ' + this.settings.legacy)
      if (this.settings.legacy && legacyResponse !== null) {
        console.log('legacey true')
        responseData = legacyResponse
        haveResponseData = true
      }
      if (!this.settings.legacy && treasuryResponse !== null) {
        console.log('legacey false')
        responseData = treasuryResponse
        haveResponseData = true
      }
    } else if (proposalResponse !== null) {
      console.log('has proposal response')
      responseData = proposalResponse
      haveResponseData = true
    }

    if (haveResponseData) {
      this.createReportTable()
      return
    }

    // const _this = this
    requestCounter++
    const thisRequest = requestCounter

    const url = this.getApiUrlByType()
    let response
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
    // create table data
    responseData = response
    if (this.settings.type === 'treasury') {
      if (this.settings.legacy) {
        legacyResponse = response
      } else {
        treasuryResponse = response
      }
    } else {
      proposalResponse = response
    }
    this.createReportTable()
  }

  legacyReportChange (e) {
    const switchCheck = document.getElementById('legacySwitchInput').checked
    this.settings.legacy = switchCheck
    this.calculate()
  }

  proposalReportTimeDetail (e) {
    const idArr = e.target.id.split(';')
    if (idArr.length !== 2) {
      return
    }
    window.location.href = '/finance-report/detail?type=' + idArr[0] + '&time=' + idArr[1].replace('/', '_')
  }
}
