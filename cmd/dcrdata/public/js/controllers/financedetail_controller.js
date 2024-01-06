import { Controller } from '@hotwired/stimulus'
import TurboQuery from '../helpers/turbolinks_helper'
import { requestJSON } from '../helpers/http'
import humanize from '../helpers/humanize_helper'

const responseCache = {}
let requestCounter = 0

function hasCache (k) {
  if (!responseCache[k]) return false
  const expiration = new Date(responseCache[k].expiration)
  return expiration > new Date()
}

export default class extends Controller {
  static get targets () {
    return ['noData', 'reportArea', 'timeInfo', 'proposalReport', 'domainReport']
  }

  async initialize () {
    this.query = new TurboQuery()
    this.settings = TurboQuery.nullTemplate([
      'type', 'time'
    ])

    this.defaultSettings = {
      type: '',
      time: ''
    }

    this.query.update(this.settings)

    if (!this.settings.type || !this.settings.time) {
      this.noDataTarget.classList.remove('d-none')
      this.reportAreaTarget.classList.add('d-none')
      return
    }
    this.timeInfoTarget.textContent = this.settings.time.replace('_', '-')
    this.noDataTarget.classList.add('d-none')
    this.reportAreaTarget.classList.remove('d-none')
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

  // Calculate and response
  async calculate () {
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
    if (!response) {
      return
    }
    this.proposalReportTarget.innerHTML = this.createProposalDetailReport(response)
    this.domainReportTarget.innerHTML = this.createDomainDetailReport(response)
  }

  createDomainDetailReport (data) {
    if (!data.reportDetail) {
      return ''
    }
    const domainMap = new Map()
    data.reportDetail.forEach((detail) => {
      if (domainMap.has(detail.domain)) {
        domainMap.set(detail.domain, domainMap.get(detail.domain) + detail.expense)
      } else {
        domainMap.set(detail.domain, detail.expense)
      }
    })
    let thead = '<thead><tr class="text-secondary finance-table-header">' +
      '###' +
      '<th class="text-center ps-0 fw-600 month-col ta-center border-left-grey report-last-header">Total</th>' +
      '</tr></thead>'
    let tbody = '<tbody>###</tbody>'

    let headList = ''
    domainMap.forEach((value, key) => {

    })

    for (let i = 0; i < data.domainList.length; i++) {
      const domain = data.domainList[i]
      headList += '<th class="text-center fw-600 pb-30i fs-13i ps-3 pr-3 table-header-sticky">' +
        `<span class="d-block pr-5">${domain}</span></th>`
    }
    thead = thead.replace('###', headList)
    let bodyList = ''
    bodyList += '<tr>'
    for (let i = 0; i < data.domainList.length; i++) {
      const domain = data.domainList[i]
      bodyList += '<td class="text-center fs-13i proposal-content-td">'
      bodyList += `$${humanize.formatToLocalString(domainMap.get(domain), 2, 2)}</td>`
    }
    bodyList += `<td class="text-center fs-13i fw-600 border-left-grey report-last-data">$${humanize.formatToLocalString(0, 2, 2)}</td></tr>`
    tbody = tbody.replace('###', bodyList)
    return thead + tbody
  }

  createProposalDetailReport (data) {
    if (!data.reportDetail) {
      return ''
    }
    let thead = '<thead><tr class="text-secondary finance-table-header">' +
      '###' +
      '<th class="text-right ps-0 fw-600 month-col ta-center border-left-grey report-last-header">Total</th>' +
      '</tr></thead>'
    let tbody = '<tbody>###</tbody>'

    let headList = ''
    for (let i = 0; i < data.reportDetail.length; i++) {
      const report = data.reportDetail[i]
      headList += '<th class="text-center fw-600 pb-30i fs-13i ps-3 pr-3 table-header-sticky">' +
        `<span class="d-block pr-5">${report.name}</span></th>`
    }
    thead = thead.replace('###', headList)
    let bodyList = ''
    bodyList += '<tr>'
    for (let i = 0; i < data.reportDetail.length; i++) {
      const report = data.reportDetail[i]
      bodyList += '<td class="text-center fs-13i proposal-content-td">'
      bodyList += `$${humanize.formatToLocalString(report.expense, 2, 2)}</td>`
    }
    bodyList += `<td class="text-center fs-13i fw-600 border-left-grey report-last-data">$${humanize.formatToLocalString(data.proposalTotal, 2, 2)}</td></tr>`
    tbody = tbody.replace('###', bodyList)
    return thead + tbody
  }
}
