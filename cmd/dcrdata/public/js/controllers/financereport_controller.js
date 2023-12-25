import { Controller } from '@hotwired/stimulus'
import TurboQuery from '../helpers/turbolinks_helper'
import { requestJSON } from '../helpers/http'
import humanize from '../helpers/humanize_helper'

const responseCache = {}
let requestCounter = 0
let responseData

function hasCache (k) {
  if (!responseCache[k]) return false
  const expiration = new Date(responseCache[k].expiration)
  return expiration > new Date()
}

export default class extends Controller {
  static get targets () {
    return ['type', 'report', 'reportTitle']
  }

  async initialize () {
    this.query = new TurboQuery()
    this.settings = TurboQuery.nullTemplate([
      'type', 'tsort', 'psort'
    ])

    this.defaultSettings = {
      type: 'proposal',
      tsort: 'oldest',
      psort: 'oldest'
    }

    this.query.update(this.settings)
    this.typeTargets.name = this.settings.type || 'proposal'
    this.reportTitleTarget.textContent = 'Finance Report - Proposals Data'
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

  typeChange (e) {
    if (e.target.name === this.settings.type) {
      return
    }
    const target = e.srcElement || e.target
    this.typeTargets.forEach((typeTarget) => {
      typeTarget.classList.remove('btn-active')
    })
    target.classList.add('btn-active')
    switch (e.target.name) {
      case 'proposal':
        this.settings.type = 'proposal'
        this.reportTitleTarget.textContent = 'Finance Report - Proposals Data'
        break
      case 'summary':
        this.settings.type = 'summary'
        this.reportTitleTarget.textContent = 'Finance Report - Proposal Summary'
        break
      case 'domain':
        this.settings.type = 'domain'
        this.reportTitleTarget.textContent = 'Finance Report - Domain Stats'
        break
      case 'treasury':
        this.settings.type = 'treasury'
        this.reportTitleTarget.textContent = 'Finance Report - Treasury Stats'
    }
    this.calculate()
  }

  getApiUrlByType () {
    switch (this.settings.type) {
      case 'treasury':
        return '/api/finance-report/treasury'
      case 'proposal':
        return `/api/finance-report/proposal?psort=${this.settings.psort}&tsort=${this.settings.tsort}`
      default:
        return '/api/finance-report/proposal'
    }
  }

  createReportTable () {
    this.updateQueryString()
    if (this.settings.type === 'treasury' || this.settings.type === 'domain') {
      this.reportTarget.classList.add('domain-group-report')
    } else {
      this.reportTarget.classList.remove('domain-group-report')
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
    this.settings.psort = (this.settings.psort === 'oldest' || !this.settings.psort || this.settings.psort === '') ? 'newest' : 'oldest'
    this.createReportTable()
  }

  createProposalTable (data) {
    if (!data.report) {
      return ''
    }
    let thead = '<thead><tr class="text-secondary finance-table-header">' +
      '<th class="text-center ps-0 month-col border-right-grey report-first-header head-first-cell">' +
      '<div class="c1"><span data-action="click->financereport#sortVertical" class="homeicon-swap vertical-sort"></span></div><div class="c2"><span data-action="click->financereport#sortHorizontal" class="homeicon-swap horizontal-sort"></span></div></th>' +
      '###' +
      '<th class="text-right ps-0 fw-600 month-col ta-center border-left-grey report-last-header">Total</th>' +
      '</tr></thead>'
    let tbody = '<tbody>###</tbody>'

    let headList = ''
    for (let i = 0; i < data.proposalList.length; i++) {
      const index = this.settings.psort === 'newest' ? i : (data.proposalList.length - i - 1)
      const proposal = data.proposalList[index]
      headList += `<th class="text-center ps-0 fs-13i ps-3 pr-3 table-header-sticky">${proposal}</th>`
    }
    thead = thead.replace('###', headList)

    let bodyList = ''
    // create tbody content
    for (let i = 0; i < data.report.length; i++) {
      const index = this.settings.tsort === 'newest' ? i : (data.report.length - i - 1)
      const report = data.report[index]
      bodyList += `<tr><td class="text-center fs-13i fw-600 border-right-grey report-first-data">${report.month}</td>`
      for (let j = 0; j < report.allData.length; j++) {
        const pindex = this.settings.psort === 'newest' ? j : (report.allData.length - j - 1)
        const allData = report.allData[pindex]
        bodyList += '<td class="text-center fs-13i">'
        if (allData.expense > 0) {
          bodyList += `$${humanize.decimalParts(allData.expense, true, 2, 2)}`
        }
        bodyList += '</td>'
      }
      bodyList += `<td class="text-right fs-13i fw-600 border-left-grey report-last-data">$${humanize.decimalParts(report.total, true, 2, 2)}</td></tr>`
    }
    bodyList += '<tr class="finance-table-header">' +
      '<td class="text-center fw-600 fs-13i report-first-header">Total</td>'

    for (let i = 0; i < data.summary.length; i++) {
      const index = this.settings.psort === 'newest' ? i : (data.summary.length - i - 1)
      const summary = data.summary[index]
      bodyList += `<td class="text-center fw-600 fs-13i">$${humanize.decimalParts(summary.totalSpent, true, 2, 2)}</td>`
    }
    bodyList += `<td class="text-center fw-600 fs-13i report-last-header">$${humanize.decimalParts(data.allSpent, true, 2, 2)}</td></tr>`

    tbody = tbody.replace('###', bodyList)
    return thead + tbody
  }

  createSummaryTable (data) {
    if (!data.report) {
      return ''
    }
    const thead = '<thead>' +
      '<tr class="text-secondary finance-table-header">' +
      '<th class="text-center ps-0 month-col fw-600 proposal-name-col">Name' +
      `<span data-action="click->financereport#sortHorizontal" class="${this.settings.psort === 'newest' ? 'dcricon-arrow-up' : 'dcricon-arrow-down'} col-sort ms-1"></span></th>` +
      '<th class="text-center ps-0 ps-3 pr-3 fw-600">Start Date</th>' +
      '<th class="text-center ps-0 ps-3 pr-3 fw-600">End Date</th>' +
      '<th class="text-center ps-0 ps-3 pr-3 fw-600">Budget</th>' +
      '<th class="text-center ps-0 ps-3 pr-3 fw-600">Total Spent (Est)</th>' +
      '<th class="text-center ps-0 ps-3 pr-3 fw-600">Total Remaining</th>' +
      '</tr></thead>'
    let tbody = '<tbody>###</tbody>'
    let bodyList = ''
    // create tbody content
    for (let i = 0; i < data.summary.length; i++) {
      const index = this.settings.psort === 'newest' ? i : (data.summary.length - i - 1)
      const summary = data.summary[index]
      bodyList += '<tr>' +
        `<td class="text-center fs-13i">${summary.name}</td>` +
        `<td class="text-center fs-13i">${summary.start}</td>` +
        `<td class="text-center fs-13i">${summary.end}</td>` +
        `<td class="text-center fs-13i">${humanize.decimalParts(summary.budget, true, 2, 2)}</td>` +
        `<td class="text-center fs-13i">${humanize.decimalParts(summary.totalSpent, true, 2, 2)}</td>` +
        `<td class="text-center fs-13i">${humanize.decimalParts(summary.totalRemaining, true, 2, 2)}</td>` +
        '</tr>'
    }

    bodyList += '<tr class="finance-table-header">' +
      '<td class="text-center fw-600 fs-15i" colspan="3">Total</td>' +
      `<td class="text-center fw-600 fs-15i">${humanize.decimalParts(data.allBudget, true, 2, 2)}</td>` +
      `<td class="text-center fw-600 fs-15i">${humanize.decimalParts(data.allSpent, true, 2, 2)}</td>` +
      `<td class="text-center fw-600 fs-15i">${humanize.decimalParts(data.allBudget - data.allSpent, true, 2, 2)}</td>` +
      '</tr>'

    tbody = tbody.replace('###', bodyList)
    return thead + tbody
  }

  createDomainTable (data) {
    if (!data.report) {
      return ''
    }
    let thead = '<thead><tr class="text-secondary finance-table-header">' +
      `<th class="text-center ps-0 month-col border-right-grey"><span data-action="click->financereport#sortVertical" class="${this.settings.tsort === 'newest' ? 'dcricon-arrow-down' : 'dcricon-arrow-up'} col-sort"></span></th>` +
      '###' +
      '<th class="text-right ps-0 fw-600 month-col ta-center border-left-grey">Total</th>' +
      '</tr></thead>'
    let tbody = '<tbody>###</tbody>'

    let headList = ''
    data.domainList.forEach((domain) => {
      headList += `<th class="text-center ps-0 fs-13i ps-3 pr-3 fw-600">${domain.charAt(0).toUpperCase() + domain.slice(1)}</th>`
    })
    thead = thead.replace('###', headList)

    let bodyList = ''
    // create tbody content
    for (let i = 0; i < data.report.length; i++) {
      const index = this.settings.tsort === 'newest' ? i : (data.report.length - i - 1)
      const report = data.report[index]
      bodyList += `<tr><td class="text-center fs-13i fw-600 border-right-grey">${report.month}</td>`
      report.domainData.forEach((domainData) => {
        bodyList += `<td class="text-center fs-13i">$${humanize.decimalParts(domainData.expense, true, 2, 2)}</td>`
      })
      bodyList += `<td class="text-right fs-13i fw-600 border-left-grey">${humanize.decimalParts(report.total, true, 2, 2)}</td></tr>`
    }

    tbody = tbody.replace('###', bodyList)
    return thead + tbody
  }

  createTreasuryTable (data) {
    if (!data.treasurySummary) {
      return ''
    }
    const thead = '<thead>' +
      '<tr class="text-secondary finance-table-header">' +
      '<th class="text-center ps-0 month-col border-right-grey"></th>' +
      '<th class="text-center ps-0 fs-13i ps-3 pr-3 fw-600">Incoming</th>' +
      '<th class="text-center ps-0 fs-13i ps-3 pr-3 fw-600">Outgoing</th>' +
      '</tr></thead>'
    let tbody = '<tbody>###</tbody>'
    let bodyList = ''
    // create tbody content
    data.treasurySummary.forEach((treasury) => {
      bodyList += '<tr>' +
        `<td class="text-center fs-13i fw-600 border-right-grey">${treasury.month}</td>` +
        `<td class="text-center fs-13i">${humanize.decimalParts((treasury.invalue / 500000000), false, 3, 2)}</td>` +
        `<td class="text-center fs-13i">${humanize.decimalParts((treasury.outvalue / 500000000), false, 3, 2)}</td>` +
        '</tr>'
    })
    tbody = tbody.replace('###', bodyList)
    console.log(thead + tbody)
    return thead + tbody
  }

  // Calculate and response
  async calculate () {
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
    this.createReportTable()
  }
}
