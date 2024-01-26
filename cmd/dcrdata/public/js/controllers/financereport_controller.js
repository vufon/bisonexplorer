import { Controller } from '@hotwired/stimulus'
import TurboQuery from '../helpers/turbolinks_helper'
import { requestJSON } from '../helpers/http'
import humanize from '../helpers/humanize_helper'

const responseCache = {}
let requestCounter = 0
let responseData
let proposalResponse = null
let treasuryResponse = null
let isSearching = false

// // Cannot set these until DyGraph is fetched.
// function createOptions () {
//   commonOptions = {
//     digitsAfterDecimal: 8,
//     showRangeSelector: true,
//     rangeSelectorHeight: 20,
//     rangeSelectorForegroundStrokeColor: '#999',
//     rangeSelectorBackgroundStrokeColor: '#777',
//     legend: 'follow',
//     fillAlpha: 0.9,
//     labelsKMB: true,
//     labelsUTC: true,
//     stepPlot: false,
//     rangeSelectorPlotFillColor: 'rgba(128, 128, 128, 0.3)',
//     rangeSelectorPlotFillGradientColor: 'transparent',
//     rangeSelectorPlotStrokeColor: 'rgba(128, 128, 128, 0.7)',
//     rangeSelectorPlotLineWidth: 2
//   }

//   chartOptions = {
//     labels: ['Month', 'Incoming', 'Outgoing'],
//     colors: ['#69D3F5', '#186CBB', '#F7AF21'],
//     ylabel: 'Treasury Values',
//     visibility: [true, true, true, true, true],
//     legendFormatter: formatter,
//     stackedGraph: true,
//     fillGraph: false
//   }
// }

const proposalNote = '*The data is the daily cost estimate based on the total budget divided by the total number of proposals days'
let treasuryNote = ''

const proposalTitle = 'Finance Report - Proposal Matrix'
const summaryTitle = 'Finance Report - Proposal List'
const domainTitle = 'Finance Report - Domains'
const treasuryTitle = 'Finance Report - Treasury Spending'
const authorTitle = 'Finance Report - Author List'

function hasCache (k) {
  if (!responseCache[k]) return false
  const expiration = new Date(responseCache[k].expiration)
  return expiration > new Date()
}

export default class extends Controller {
  static get targets () {
    return ['type', 'report', 'reportTitle', 'colorNoteRow', 'colorLabel', 'colorDescription',
      'interval', 'groupBy', 'searchInput', 'searchBtn', 'clearSearchBtn', 'searchBox', 'nodata',
      'treasuryToggleArea', 'legacyTable', 'legacyTitle', 'reportDescription', 'reportAllPage',
      'activeProposalSwitchArea']
  }

  async initialize () {
    this.query = new TurboQuery()
    this.settings = TurboQuery.nullTemplate([
      'type', 'tsort', 'lsort', 'psort', 'stype', 'order', 'interval', 'search', 'usd', 'active'
    ])

    this.defaultSettings = {
      type: 'proposal',
      tsort: 'oldest',
      lsort: 'oldest',
      psort: 'newest',
      stype: 'startdt',
      order: 'desc',
      interval: 'month',
      search: '',
      usd: false,
      active: false
    }

    this.query.update(this.settings)
    if (!this.settings.type) {
      this.settings.type = this.defaultSettings.type
    }
    if (!this.settings.interval) {
      this.settings.interval = this.defaultSettings.interval
    }
    if (this.settings.search) {
      this.searchInputTarget.value = this.settings.search
      isSearching = true
      this.searchBtnTarget.classList.add('d-none')
      this.clearSearchBtnTarget.classList.remove('d-none')
    } else {
      this.searchBtnTarget.classList.remove('d-none')
      this.clearSearchBtnTarget.classList.add('d-none')
    }

    this.typeTargets.forEach((typeTarget) => {
      typeTarget.classList.remove('btn-active')
      if (typeTarget.name === this.settings.type) {
        typeTarget.classList.add('btn-active')
      }
    })
    if (this.settings.type !== 'proposal') {
      this.intervalTargets.forEach((intervalTarget) => {
        intervalTarget.classList.remove('btn-active')
        if (intervalTarget.name === this.settings.interval) {
          intervalTarget.classList.add('btn-active')
        }
      })
    }
    const devAddress = this.data.get('devAddress')
    treasuryNote = `*All numbers are pulled from the blockchain. Includes <a href="/treasury">treasury</a> and <a href="/address/${devAddress}">legacy</a> data`

    this.setReportTitle(this.settings.type)
    this.calculate()
  }

  searchInputKeypress (e) {
    if (e.keyCode === 13) {
      this.searchProposal()
    }
  }

  onTypeChange (e) {
    if (!e.target.value || e.target.value === '') {
      return
    }
    this.searchBtnTarget.classList.remove('d-none')
    this.clearSearchBtnTarget.classList.add('d-none')
  }

  searchProposal () {
    // if search key is empty, ignore
    if (!this.searchInputTarget.value || this.searchInputTarget.value === '') {
      this.searchBtnTarget.classList.remove('d-none')
      this.clearSearchBtnTarget.classList.add('d-none')
      if (isSearching) {
        this.settings.search = this.defaultSettings.search
        isSearching = false
        this.calculate()
      }
      return
    }
    this.searchBtnTarget.classList.add('d-none')
    this.clearSearchBtnTarget.classList.remove('d-none')
    this.settings.search = this.searchInputTarget.value
    this.calculate()
  }

  clearSearch (e) {
    this.settings.search = this.defaultSettings.search
    this.searchInputTarget.value = ''
    this.searchBtnTarget.classList.remove('d-none')
    this.clearSearchBtnTarget.classList.add('d-none')
    isSearching = false
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
        this.reportDescriptionTarget.innerHTML = proposalNote
        this.settings.interval = this.defaultSettings.interval
        this.intervalTargets.forEach((intervalTarget) => {
          intervalTarget.classList.remove('btn-active')
          if (intervalTarget.name === this.settings.interval) {
            intervalTarget.classList.add('btn-active')
          }
        })
        break
      case 'summary':
        this.reportTitleTarget.innerHTML = summaryTitle
        this.reportDescriptionTarget.innerHTML = proposalNote
        break
      case 'domain':
        this.reportTitleTarget.innerHTML = domainTitle
        this.reportDescriptionTarget.innerHTML = proposalNote
        break
      case 'treasury':
        this.reportTitleTarget.innerHTML = treasuryTitle
        this.reportDescriptionTarget.innerHTML = treasuryNote
        break
      case 'author':
        this.reportTitleTarget.innerHTML = authorTitle
        this.reportDescriptionTarget.innerHTML = proposalNote
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
    this.settings.tsort = this.defaultSettings.tsort
    this.settings.lsort = this.defaultSettings.lsort
    this.settings.psort = this.defaultSettings.psort
    this.settings.stype = this.defaultSettings.stype
    this.settings.order = this.defaultSettings.order
    this.setReportTitle(e.target.name)
    this.calculate()
  }

  getApiUrlByType () {
    switch (this.settings.type) {
      case 'treasury':
        return '/api/finance-report/treasury'
      default:
        return `/api/finance-report/proposal?search=${!this.settings.search ? '' : this.settings.search}`
    }
  }

  createReportTable () {
    if (this.settings.type === 'proposal') {
      this.colorNoteRowTarget.classList.remove('d-none')
      this.colorLabelTarget.classList.remove('summary-note-color')
      this.colorLabelTarget.classList.add('proposal-note-color')
      this.colorDescriptionTarget.textContent = (this.settings.interval === 'year' ? 'Valid payment year' : 'Valid payment month') + ' (Estimate)'
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
    // if summary, display toggle for filter Proposals are active
    if (this.settings.type === 'summary') {
      this.activeProposalSwitchAreaTarget.classList.remove('d-none')
      if (!this.settings.active || this.settings.active === 'false') {
        document.getElementById('activeProposalInput').checked = false
      } else {
        document.getElementById('activeProposalInput').checked = true
      }
    } else {
      this.settings.active = false
      this.activeProposalSwitchAreaTarget.classList.add('d-none')
    }

    this.updateQueryString()

    if (this.settings.type === 'treasury') {
      this.reportTarget.classList.add('treasury-group-report')
      this.legacyTableTarget.classList.remove('d-none')
      this.legacyTitleTarget.classList.remove('d-none')
      this.treasuryToggleAreaTarget.classList.remove('d-none')
      if (!this.settings.usd || this.settings.usd === 'false') {
        document.getElementById('usdSwitchInput').checked = false
      } else {
        document.getElementById('usdSwitchInput').checked = true
      }
      this.createTreasuryTable(responseData)
    } else {
      this.reportTarget.classList.add('treasury-group-report')
      this.treasuryToggleAreaTarget.classList.add('d-none')
      this.legacyTableTarget.classList.add('d-none')
      this.legacyTitleTarget.classList.add('d-none')
    }

    if (this.settings.type === 'author') {
      this.reportTarget.classList.add('author-group-report')
    } else {
      this.reportTarget.classList.remove('author-group-report')
    }

    if (this.settings.type === 'domain' || this.settings.type === 'treasury') {
      this.reportTarget.classList.remove('summary-group-report')
      this.groupByTarget.classList.remove('d-none')
    } else {
      if (this.settings.type !== 'author') {
        this.reportTarget.classList.add('summary-group-report')
      } else {
        this.reportTarget.classList.remove('summary-group-report')
      }
      this.groupByTarget.classList.add('d-none')
    }

    // if treasury, get table content in other area
    if (this.settings.type !== 'treasury') {
      this.reportTarget.innerHTML = this.createTableContent()
    }

    if (this.settings.type === 'proposal') {
      // add proposal class for proposals
      if (this.settings.interval !== 'year') {
        this.reportAllPageTarget.classList.add('proposal-report-page')
      } else {
        this.reportAllPageTarget.classList.remove('proposal-report-page')
      }
      // handler for scroll default
      if (this.settings.psort === 'oldest') {
        if (this.settings.tsort === 'newest') {
          window.scrollTo(document.body.scrollWidth, 0)
        } else {
          window.scrollTo(0, 0)
        }
      } else {
        if (this.settings.tsort === 'newest') {
          window.scrollTo(0, 0)
        } else {
          window.scrollTo(document.body.scrollWidth, 0)
        }
      }
    } else {
      this.reportAllPageTarget.classList.remove('proposal-report-page')
    }
  }

  createTableContent () {
    switch (this.settings.type) {
      case 'summary':
        return this.createSummaryTable(responseData)
      case 'domain':
        return this.createDomainTable(responseData)
      case 'author':
        return this.createAuthorTable(responseData)
      default:
        return this.createProposalTable(responseData)
    }
  }

  sortByCreateDate () {
    this.settings.tsort = (this.settings.tsort === 'oldest' || !this.settings.tsort || this.settings.tsort === '') ? 'newest' : 'oldest'
    this.createReportTable()
  }

  sortByLegacyMonth () {
    this.settings.lsort = (this.settings.lsort === 'oldest' || !this.settings.lsort || this.settings.lsort === '') ? 'newest' : 'oldest'
    this.createReportTable()
  }

  sortByDate () {
    this.settings.psort = (this.settings.psort === 'newest' || !this.settings.psort || this.settings.psort === '') ? 'oldest' : 'newest'
    this.createReportTable()
  }

  sortByStartDate () {
    this.sortByType('startdt')
  }

  sortByPName () {
    this.sortByType('pname')
  }

  sortByDomain () {
    this.sortByType('domain')
  }

  sortByAuthor () {
    this.sortByType('author')
  }

  sortByPNum () {
    this.sortByType('pnum')
  }

  sortByBudget () {
    this.sortByType('budget')
  }

  sortByTotalSpent () {
    this.sortByType('spent')
  }

  sortByRemaining () {
    this.sortByType('remaining')
  }

  sortByEndDate () {
    this.sortByType('enddt')
  }

  sortByType (type) {
    this.settings.stype = type
    this.settings.order = this.settings.order === 'esc' ? 'desc' : 'esc'
    this.createReportTable()
  }

  getTreasuryYearlyData (summary) {
    const dataMap = new Map()
    const yearArr = []
    for (let i = 0; i < summary.length; i++) {
      const item = summary[i]
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
          monthObj.outEstimate += item.outEstimate
          monthObj.outEstimateUsd += item.outEstimateUsd
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
          monthObj.outEstimate = item.outEstimate
          monthObj.outEstimateUsd = item.outEstimateUsd
        }
        dataMap.set(year, monthObj)
      }
    }
    const result = []
    yearArr.forEach((year) => {
      result.push(dataMap.get(year))
    })
    return result
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

    if (handlerData.report.length < 1) {
      this.nodataTarget.classList.remove('d-none')
      this.reportTarget.classList.add('d-none')
      return
    }
    this.nodataTarget.classList.add('d-none')
    this.reportTarget.classList.remove('d-none')

    let thead = '<thead><tr class="text-secondary finance-table-header">' +
      '<th class="text-center ps-0 month-col border-right-grey report-first-header head-first-cell">' +
      '<div class="c1"><span data-action="click->financereport#sortByDate" class="homeicon-swap vertical-sort"></span></div><div class="c2"><span data-action="click->financereport#sortByCreateDate" class="homeicon-swap horizontal-sort"></span></div></th>' +
      '###' +
      '<th class="text-right ps-0 fw-600 month-col ta-center border-left-grey report-last-header va-mid">Total</th>' +
      '</tr></thead>'
    let tbody = '<tbody>###</tbody>'

    let headList = ''
    const proposalTokenMap = data.proposalTokenMap
    for (let i = 0; i < handlerData.report.length; i++) {
      const index = this.settings.tsort === 'newest' ? i : (handlerData.report.length - i - 1)
      const report = handlerData.report[index]
      const timeParam = this.getFullTimeParam(report.month, '/')

      if (this.settings.interval === 'year') {
        headList += `<th class="text-center fw-600 pb-30i fs-13i table-header-sticky va-mid" id="${this.settings.interval + ';' + report.month}">`
        headList += '<div class="d-flex justify-content-center">'
        headList += `<a class="link-hover-underline fs-13i" style="text-align: right; width: 80px;" href="${'/finance-report/detail?type=' + this.settings.interval + '&time=' + (timeParam === '' ? report.month : timeParam)}">${report.month.replace('/', '-')}`
        headList += '</a></div></th>'
      } else {
        headList += '<th class="text-right fw-600 pb-30i fs-13i ps-3 pr-3 table-header-sticky va-mid" ' +
        `id="${this.settings.interval + ';' + report.month}" ` +
        `><a class="link-hover-underline fs-13i" href="${'/finance-report/detail?type=' + this.settings.interval + '&time=' + (timeParam === '' ? report.month : timeParam)}"><span class="d-block pr-5">${report.month.replace('/', '-')}</span></a></th>`
      }
    }
    thead = thead.replace('###', headList)

    let bodyList = ''
    for (let i = 0; i < handlerData.proposalList.length; i++) {
      const index = this.settings.psort === 'oldest' ? (handlerData.proposalList.length - i - 1) : i
      const proposal = handlerData.proposalList[index]
      let token = ''
      if (proposalTokenMap[proposal] && proposalTokenMap[proposal] !== '') {
        token = proposalTokenMap[proposal]
      }
      bodyList += `<tr><td class="text-center fs-13i border-right-grey report-first-data"><a href="${'/finance-report/detail?type=proposal&token=' + token}" class="link-hover-underline fs-13i d-block ${this.settings.interval === 'year' ? 'proposal-year-title' : 'proposal-title-col'}">${proposal}</a></td>`
      for (let j = 0; j < handlerData.report.length; j++) {
        const tindex = this.settings.tsort === 'newest' ? j : (handlerData.report.length - j - 1)
        const report = handlerData.report[tindex]
        const allData = report.allData[index]
        if (allData.expense > 0) {
          if (this.settings.interval === 'year') {
            bodyList += `<td class="${this.settings.interval === 'year' ? 'text-center' : 'text-right'} fs-13i proposal-content-td va-mid">`
            bodyList += '<div class="d-flex justify-content-center">'
            bodyList += `<span style="text-align: right; width: 80px;">$${humanize.formatToLocalString(allData.expense, 2, 2)}</span>`
            bodyList += '</div>'
          } else {
            bodyList += '<td class="text-right fs-13i proposal-content-td va-mid">'
            bodyList += `$${humanize.formatToLocalString(allData.expense, 2, 2)}`
          }
        } else {
          bodyList += '<td class="text-center fs-13i">'
        }
        bodyList += '</td>'
      }
      bodyList += `<td class="text-right fs-13i fw-600 border-left-grey report-last-data va-mid">$${humanize.formatToLocalString(handlerData.summary[index].totalSpent, 2, 2)}</td></tr>`
    }

    bodyList += '<tr class="finance-table-header">' +
      '<td class="text-center fw-600 fs-13i report-first-header va-mid">Total</td>'
    for (let i = 0; i < handlerData.report.length; i++) {
      const index = this.settings.tsort === 'newest' ? i : (handlerData.report.length - i - 1)
      const report = handlerData.report[index]
      if (this.settings.interval === 'year') {
        bodyList += '<td class="text-center fw-600 fs-13i va-mid">'
        bodyList += '<div class="d-flex justify-content-center">'
        bodyList += `<span style="text-align: right; width: 80px;">$${humanize.formatToLocalString(report.total, 2, 2)}</span>`
        bodyList += '</div>'
        bodyList += '</td>'
      } else {
        bodyList += `<td class="text-right fw-600 fs-13i va-mid">$${humanize.formatToLocalString(report.total, 2, 2)}</td>`
      }
    }

    bodyList += `<td class="text-right fw-600 fs-13i report-last-header va-mid">$${humanize.formatToLocalString(handlerData.allSpent, 2, 2)}</td></tr>`

    tbody = tbody.replace('###', bodyList)
    return thead + tbody
  }

  createSummaryTable (data) {
    if (!data.report) {
      return ''
    }
    if (data.summary.length < 1) {
      this.nodataTarget.classList.remove('d-none')
      this.reportTarget.classList.add('d-none')
      return
    }
    this.nodataTarget.classList.add('d-none')
    this.reportTarget.classList.remove('d-none')

    const thead = '<thead>' +
      '<tr class="text-secondary finance-table-header">' +
      '<th class="va-mid text-center month-col fw-600 proposal-name-col"><label class="cursor-pointer" data-action="click->financereport#sortByPName">Name</label>' +
      `<span data-action="click->financereport#sortByPName" class="${(this.settings.stype === 'pname' && this.settings.order === 'desc') ? 'dcricon-arrow-down' : 'dcricon-arrow-up'} ${this.settings.stype !== 'pname' ? 'c-grey-3' : ''} col-sort ms-1"></span></th>` +
      '<th class="va-mid text-center px-3 month-col fw-600"><label class="cursor-pointer" data-action="click->financereport#sortByDomain">Domain</label>' +
      `<span data-action="click->financereport#sortByDomain" class="${(this.settings.stype === 'domain' && this.settings.order === 'desc') ? 'dcricon-arrow-down' : 'dcricon-arrow-up'} ${this.settings.stype !== 'domain' ? 'c-grey-3' : ''} col-sort ms-1"></span></th>` +
      '<th class="va-mid text-center px-3 month-col fw-600"><label class="cursor-pointer" data-action="click->financereport#sortByAuthor">Author</label>' +
      `<span data-action="click->financereport#sortByAuthor" class="${(this.settings.stype === 'author' && this.settings.order === 'desc') ? 'dcricon-arrow-down' : 'dcricon-arrow-up'} ${this.settings.stype !== 'author' ? 'c-grey-3' : ''} col-sort ms-1"></span></th>` +
      '<th class="va-mid text-center px-3 fw-600"><label class="cursor-pointer" data-action="click->financereport#sortByStartDate">Start Date</label>' +
      `<span data-action="click->financereport#sortByStartDate" class="${(this.settings.stype === 'startdt' && this.settings.order === 'desc') ? 'dcricon-arrow-down' : 'dcricon-arrow-up'} ${(!this.settings.stype || this.settings.stype === '' || this.settings.stype === 'startdt') ? '' : 'c-grey-3'} col-sort ms-1"></span></th>` +
      '<th class="va-mid text-center px-3 fw-600"><label class="cursor-pointer" data-action="click->financereport#sortByEndDate">End Date</label>' +
      `<span data-action="click->financereport#sortByEndDate" class="${(this.settings.stype === 'enddt' && this.settings.order === 'desc') ? 'dcricon-arrow-down' : 'dcricon-arrow-up'} ${this.settings.stype !== 'enddt' ? 'c-grey-3' : ''} col-sort ms-1"></span></th>` +
      '<th class="va-mid text-right px-3 fw-600"><label class="cursor-pointer" data-action="click->financereport#sortByBudget">Budget</label>' +
      `<span data-action="click->financereport#sortByBudget" class="${(this.settings.stype === 'budget' && this.settings.order === 'desc') ? 'dcricon-arrow-down' : 'dcricon-arrow-up'} ${this.settings.stype !== 'budget' ? 'c-grey-3' : ''} col-sort ms-1"></span></th>` +
      '<th class="va-mid text-right px-3 fw-600">Days</th>' +
      '<th class="va-mid text-right px-3 fw-600">Monthly Avg (Est)</th>' +
      '<th class="va-mid text-right px-3 fw-600"><label class="cursor-pointer" data-action="click->financereport#sortByTotalSpent">Total Spent (Est)</label>' +
      `<span data-action="click->financereport#sortByTotalSpent" class="${(this.settings.stype === 'spent' && this.settings.order === 'desc') ? 'dcricon-arrow-down' : 'dcricon-arrow-up'} ${this.settings.stype !== 'spent' ? 'c-grey-3' : ''} col-sort ms-1"></span></th>` +
      '<th class="va-mid text-right px-3 fw-600 pr-10i"><label class="cursor-pointer" data-action="click->financereport#sortByRemaining">Total Remaining (Est)</label>' +
      `<span data-action="click->financereport#sortByRemaining" class="${(this.settings.stype === 'remaining' && this.settings.order === 'desc') ? 'dcricon-arrow-down' : 'dcricon-arrow-up'} ${this.settings.stype !== 'remaining' ? 'c-grey-3' : ''} col-sort ms-1"></span></th>` +
      '</tr></thead>'
    let tbody = '<tbody>###</tbody>'
    let bodyList = ''
    const proposalTokenMap = data.proposalTokenMap
    // Handler sort before display data
    // sort by param
    const summaryList = this.sortSummary(data.summary)
    // create tbody content
    for (let i = 0; i < summaryList.length; i++) {
      const summary = summaryList[i]
      if ((this.settings.active || this.settings.active === 'true') && summary.totalRemaining === 0.0) {
        continue
      }
      let token = ''
      if (proposalTokenMap[summary.name] && proposalTokenMap[summary.name] !== '') {
        token = proposalTokenMap[summary.name]
      }
      const lengthInDays = this.getLengthInDay(summary)
      const monthlyAverage = (summary.budget / lengthInDays) * 30
      bodyList += `<tr${summary.totalRemaining === 0.0 ? '' : ' class="summary-active-row"'}>` +
        `<td class="va-mid text-center fs-13i"><a href="${'/finance-report/detail?type=proposal&token=' + token}" class="link-hover-underline fs-13i">${summary.name}</a></td>` +
        `<td class="va-mid text-center px-3 fs-13i"><a href="${'/finance-report/detail?type=domain&name=' + summary.domain}" class="link-hover-underline fs-13i">${summary.domain.charAt(0).toUpperCase() + summary.domain.slice(1)}</a></td>` +
        `<td class="va-mid text-center px-3 fs-13i"><a href="${'/finance-report/detail?type=owner&name=' + summary.author}" class="link-hover-underline fs-13i">${summary.author}</a></td>` +
        `<td class="va-mid text-center px-3 fs-13i">${summary.start}</td>` +
        `<td class="va-mid text-center px-3 fs-13i">${summary.end}</td>` +
        `<td class="va-mid text-right px-3 fs-13i">$${humanize.formatToLocalString(summary.budget, 2, 2)}</td>` +
        `<td class="va-mid text-right px-3 fs-13i">${lengthInDays}</td>` +
        `<td class="va-mid text-right px-3 fs-13i">${humanize.formatToLocalString(monthlyAverage, 2, 2)}</td>` +
        `<td class="va-mid text-right px-3 fs-13i">$${humanize.formatToLocalString(summary.totalSpent, 2, 2)}</td>` +
        `<td class="va-mid text-right px-3 fs-13i pr-10i">$${humanize.formatToLocalString(summary.totalRemaining, 2, 2)}</td>` +
        '</tr>'
    }

    bodyList += '<tr class="finance-table-header">' +
      '<td class="va-mid text-center fw-600 fs-15i" colspan="5">Total</td>' +
      `<td class="va-mid text-right px-3 fw-600 fs-15i">$${humanize.formatToLocalString(data.allBudget, 2, 2)}</td>` +
      '<td></td><td></td>' +
      `<td class="va-mid text-right px-3 fw-600 fs-15i">$${humanize.formatToLocalString(data.allSpent, 2, 2)}</td>` +
      `<td class="va-mid text-right px-2 fw-600 fs-15i">$${humanize.formatToLocalString(data.allBudget - data.allSpent, 2, 2)}</td>` +
      '</tr>'

    tbody = tbody.replace('###', bodyList)
    return thead + tbody
  }

  getLengthInDay (summary) {
    const start = Date.parse(summary.start)
    const end = Date.parse(summary.end)
    const oneDay = 24 * 60 * 60 * 1000

    return Math.round(Math.abs((end - start) / oneDay))
  }

  sortAuthorData (authorList) {
    switch (this.settings.stype) {
      case 'budget':
        return this.sortSummaryByBudget(authorList)
      case 'spent':
        return this.sortAuthorByTotalReceived(authorList)
      case 'remaining':
        return this.sortAuthorByRemaining(authorList)
      case 'pnum':
        return this.sortAuthorByProposalNum(authorList)
      default:
        return this.sortSummaryByName(authorList)
    }
  }

  sortAuthorByProposalNum (authorList) {
    if (!authorList) {
      return
    }
    const _this = this
    authorList.sort(function (a, b) {
      if (a.proposals > b.proposals) {
        return _this.settings.order === 'desc' ? -1 : 1
      }
      if (a.proposals < b.proposals) {
        return _this.settings.order === 'desc' ? 1 : -1
      }
      return 0
    })

    return authorList
  }

  sortAuthorByRemaining (authorList) {
    if (!authorList) {
      return
    }
    const _this = this
    authorList.sort(function (a, b) {
      if (a.totalRemaining > b.totalRemaining) {
        return _this.settings.order === 'desc' ? -1 : 1
      }
      if (a.totalRemaining < b.totalRemaining) {
        return _this.settings.order === 'desc' ? 1 : -1
      }
      return 0
    })

    return authorList
  }

  sortAuthorByTotalReceived (authorList) {
    if (!authorList) {
      return
    }
    const _this = this
    authorList.sort(function (a, b) {
      if (a.totalReceived > b.totalReceived) {
        return _this.settings.order === 'desc' ? -1 : 1
      }
      if (a.totalReceived < b.totalReceived) {
        return _this.settings.order === 'desc' ? 1 : -1
      }
      return 0
    })

    return authorList
  }

  sortSummary (summary) {
    switch (this.settings.stype) {
      case 'pname':
        return this.sortSummaryByName(summary)
      case 'domain':
        return this.sortSummaryByDomain(summary)
      case 'author':
        return this.sortSummaryByAuthor(summary)
      case 'budget':
        return this.sortSummaryByBudget(summary)
      case 'spent':
        return this.sortSummaryBySpent(summary)
      case 'remaining':
        return this.sortSummaryByRemaining(summary)
      case 'enddt':
        return this.sortSummaryByDate(summary, false)
      default:
        return this.sortSummaryByDate(summary, true)
    }
  }

  sortSummaryByDate (summary, isStart) {
    if (!summary) {
      return
    }
    const _this = this
    summary.sort(function (a, b) {
      const date1 = Date.parse(isStart ? a.start : a.end)
      const date2 = Date.parse(isStart ? b.start : b.end)
      if (date1 > date2) {
        return _this.settings.order === 'desc' ? -1 : 1
      }
      if (date1 < date2) {
        return _this.settings.order === 'desc' ? 1 : -1
      }
      return 0
    })

    return summary
  }

  sortSummaryByRemaining (summary) {
    if (!summary) {
      return
    }
    const _this = this
    summary.sort(function (a, b) {
      if (a.totalRemaining > b.totalRemaining) {
        return _this.settings.order === 'desc' ? -1 : 1
      }
      if (a.totalRemaining < b.totalRemaining) {
        return _this.settings.order === 'desc' ? 1 : -1
      }
      return 0
    })

    return summary
  }

  sortSummaryBySpent (summary) {
    if (!summary) {
      return
    }
    const _this = this
    summary.sort(function (a, b) {
      if (a.totalSpent > b.totalSpent) {
        return _this.settings.order === 'desc' ? -1 : 1
      }
      if (a.totalSpent < b.totalSpent) {
        return _this.settings.order === 'desc' ? 1 : -1
      }
      return 0
    })

    return summary
  }

  sortSummaryByBudget (summary) {
    if (!summary) {
      return
    }
    const _this = this
    summary.sort(function (a, b) {
      if (a.budget > b.budget) {
        return _this.settings.order === 'desc' ? -1 : 1
      }
      if (a.budget < b.budget) {
        return _this.settings.order === 'desc' ? 1 : -1
      }
      return 0
    })

    return summary
  }

  sortByStartdt (summary) {
    if (this.settings.order !== 'esc') {
      return summary
    }
    const result = []
    for (let i = summary.length - 1; i >= 0; i--) {
      result.push(summary[i])
    }
    return result
  }

  sortSummaryByDomain (summary) {
    if (!summary) {
      return
    }
    const _this = this
    summary.sort(function (a, b) {
      if (a.domain > b.domain) {
        return _this.settings.order === 'desc' ? -1 : 1
      } else if (a.domain < b.domain) {
        return _this.settings.order === 'desc' ? 1 : -1
      } else {
        if (a.name > b.name) {
          return _this.settings.order === 'desc' ? -1 : 1
        }
        if (a.name < b.name) {
          return _this.settings.order === 'desc' ? 1 : -1
        }
      }
      return 0
    })

    return summary
  }

  sortSummaryByName (summary) {
    if (!summary) {
      return
    }
    const _this = this
    summary.sort(function (a, b) {
      if (a.name > b.name) {
        return _this.settings.order === 'desc' ? -1 : 1
      }
      if (a.name < b.name) {
        return _this.settings.order === 'desc' ? 1 : -1
      }
      return 0
    })

    return summary
  }

  sortSummaryByAuthor (summary) {
    if (!summary) {
      return
    }
    const _this = this
    summary.sort(function (a, b) {
      if (a.author > b.author) {
        return _this.settings.order === 'desc' ? -1 : 1
      }
      if (a.author < b.author) {
        return _this.settings.order === 'desc' ? 1 : -1
      }
      return 0
    })

    return summary
  }

  swapItemOnArray (array, index1, index2) {
    const temp = array[index1]
    array[index1] = index2
    array[index2] = temp
  }

  createAuthorTable (data) {
    if (!data.authorReport) {
      return ''
    }
    const thead = '<thead>' +
    '<tr class="text-secondary finance-table-header">' +
    '<th class="va-mid text-center px-3 month-col fw-600"><label class="cursor-pointer" data-action="click->financereport#sortByAuthor">Author</label>' +
    `<span data-action="click->financereport#sortByAuthor" class="${(this.settings.stype === 'pname' && this.settings.order === 'desc') ? 'dcricon-arrow-down' : 'dcricon-arrow-up'} ${this.settings.stype !== 'pname' ? 'c-grey-3' : ''} col-sort ms-1"></span></th>` +
    '<th class="va-mid text-center px-3 fw-600"><label class="cursor-pointer" data-action="click->financereport#sortByPNum">Proposals</label>' +
    `<span data-action="click->financereport#sortByPNum" class="${(this.settings.stype === 'pnum' && this.settings.order === 'desc') ? 'dcricon-arrow-down' : 'dcricon-arrow-up'} ${this.settings.stype !== 'pnum' ? 'c-grey-3' : ''} col-sort ms-1"></span></th>` +
    '<th class="va-mid text-right px-3 fw-600"><label class="cursor-pointer" data-action="click->financereport#sortByBudget">Total Budget</label>' +
    `<span data-action="click->financereport#sortByBudget" class="${(this.settings.stype === 'budget' && this.settings.order === 'desc') ? 'dcricon-arrow-down' : 'dcricon-arrow-up'} ${this.settings.stype !== 'budget' ? 'c-grey-3' : ''} col-sort ms-1"></span></th>` +
    '<th class="va-mid text-right px-3 fw-600"><label class="cursor-pointer" data-action="click->financereport#sortByTotalSpent">Total Received (Est)</label>' +
    `<span data-action="click->financereport#sortByTotalSpent" class="${(this.settings.stype === 'spent' && this.settings.order === 'desc') ? 'dcricon-arrow-down' : 'dcricon-arrow-up'} ${this.settings.stype !== 'spent' ? 'c-grey-3' : ''} col-sort ms-1"></span></th>` +
    '<th class="va-mid text-right px-3 fw-600 pr-10i"><label class="cursor-pointer" data-action="click->financereport#sortByRemaining">Total Remaining (Est)</label>' +
    `<span data-action="click->financereport#sortByRemaining" class="${(this.settings.stype === 'remaining' && this.settings.order === 'desc') ? 'dcricon-arrow-down' : 'dcricon-arrow-up'} ${this.settings.stype !== 'remaining' ? 'c-grey-3' : ''} col-sort ms-1"></span></th>` +
    '</tr></thead>'
    let tbody = '<tbody>###</tbody>'
    let bodyList = ''
    let totalBudget = 0
    let totalSpent = 0
    let totalRemaining = 0
    let totalProposals = 0
    // Handler sort before display data
    const authorList = this.sortAuthorData(data.authorReport)
    // create tbody content
    for (let i = 0; i < authorList.length; i++) {
      const author = authorList[i]
      totalBudget += author.budget
      totalSpent += author.totalReceived
      totalRemaining += author.totalRemaining
      totalProposals += author.proposals
      bodyList += `<tr><td class="va-mid text-center px-3 fs-13i fw-600"><a class="link-hover-underline fs-13i" href="${'/finance-report/detail?type=owner&name=' + author.name}">${author.name}</a></td>`
      bodyList += `<td class="va-mid text-center px-3 fs-13i">${author.proposals}</td>`
      bodyList += `<td class="va-mid text-right px-3 fs-13i">$${humanize.formatToLocalString(author.budget, 2, 2)}</td>`
      bodyList += `<td class="va-mid text-right px-3 fs-13i">$${humanize.formatToLocalString(author.totalReceived, 2, 2)}</td>`
      bodyList += `<td class="va-mid text-right px-3 fs-13i">$${humanize.formatToLocalString(author.totalRemaining, 2, 2)}</td></tr>`
    }

    bodyList += '<tr class="finance-table-header">' +
      '<td class="va-mid text-center px-3 fw-600 fs-15i">Total</td>' +
      `<td class="va-mid text-center px-3 fw-600 fs-15i">${totalProposals}</td>` +
      `<td class="va-mid text-right px-3 fw-600 fs-15i">$${humanize.formatToLocalString(totalBudget, 2, 2)}</td>` +
      `<td class="va-mid text-right px-3 fw-600 fs-15i">$${humanize.formatToLocalString(totalSpent, 2, 2)}</td>` +
      `<td class="va-mid text-right px-3 fw-600 fs-15i">$${humanize.formatToLocalString(totalRemaining, 2, 2)}</td>` +
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

    if (handlerData.report.length < 1) {
      this.nodataTarget.classList.remove('d-none')
      this.reportTarget.classList.add('d-none')
      return
    }
    this.nodataTarget.classList.add('d-none')
    this.reportTarget.classList.remove('d-none')

    let thead = '<thead><tr class="text-secondary finance-table-header">' +
      `<th class="va-mid text-center ps-0 month-col border-right-grey"><span data-action="click->financereport#sortByCreateDate" class="${this.settings.tsort === 'newest' ? 'dcricon-arrow-down' : 'dcricon-arrow-up'} col-sort"></span></th>` +
      '###' +
      '<th class="va-mid text-right ps-0 fw-600 month-col ta-center border-left-grey">Total</th>' +
      '</tr></thead>'
    let tbody = '<tbody>###</tbody>'

    let headList = ''
    handlerData.domainList.forEach((domain) => {
      headList += `<th class="va-mid text-right-i domain-content-cell ps-0 fs-13i ps-3 pr-3 fw-600"><a href="${'/finance-report/detail?type=domain&name=' + domain}" class="link-hover-underline fs-13i">${domain.charAt(0).toUpperCase() + domain.slice(1)} (Est)</a></th>`
    })
    thead = thead.replace('###', headList)

    let bodyList = ''
    const domainDataMap = new Map()
    // create tbody content
    for (let i = 0; i < handlerData.report.length; i++) {
      const index = this.settings.tsort === 'newest' ? i : (handlerData.report.length - i - 1)
      const report = handlerData.report[index]
      const timeParam = this.getFullTimeParam(report.month, '/')
      bodyList += `<tr><td class="va-mid text-center fs-13i fw-600 border-right-grey"><a class="link-hover-underline fs-13i" style="text-align: right; width: 80px;" href="${'/finance-report/detail?type=' + this.settings.interval + '&time=' + (timeParam === '' ? report.month : timeParam)}">${report.month.replace('/', '-')}</a></td>`
      report.domainData.forEach((domainData) => {
        bodyList += `<td class="va-mid text-right-i domain-content-cell fs-13i">$${humanize.formatToLocalString(domainData.expense, 2, 2)}</td>`
        if (domainDataMap.has(domainData.domain)) {
          domainDataMap.set(domainData.domain, domainDataMap.get(domainData.domain) + domainData.expense)
        } else {
          domainDataMap.set(domainData.domain, domainData.expense)
        }
      })
      bodyList += `<td class="va-mid text-right fs-13i fw-600 border-left-grey">${humanize.formatToLocalString(report.total, 2, 2)}</td></tr>`
    }

    bodyList += '<tr class="finance-table-header"><td class="text-center fw-600 fs-15i border-right-grey">Total (Est)</td>'
    let totalAll = 0
    handlerData.domainList.forEach((domain) => {
      bodyList += `<td class="va-mid text-right fw-600 fs-13i domain-content-cell">$${humanize.formatToLocalString(domainDataMap.get(domain), 2, 2)}</td>`
      totalAll += domainDataMap.get(domain)
    })
    bodyList += `<td class="va-mid text-right fw-600 fs-13i border-left-grey">$${humanize.formatToLocalString(totalAll, 2, 2)}</td>`
    bodyList += '</tr>'

    tbody = tbody.replace('###', bodyList)
    return thead + tbody
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

  createTreasuryTable (data) {
    if (!data.treasurySummary) {
      return ''
    }
    let treasuryData = data.treasurySummary
    let legacyData = data.legacySummary
    if (this.settings.interval === 'year') {
      treasuryData = this.getTreasuryYearlyData(treasuryData)
      legacyData = this.getTreasuryYearlyData(legacyData)
    }
    this.reportTarget.innerHTML = this.createTreasuryLegacyTableContent(treasuryData, false)
    this.legacyTableTarget.innerHTML = this.createTreasuryLegacyTableContent(legacyData, true)
  }

  createTreasuryLegacyTableContent (summary, isLegacy) {
    let thead = '<thead>' +
      '<tr class="text-secondary finance-table-header">'
    if (isLegacy) {
      thead += `<th class="va-mid text-center ps-0 month-col border-right-grey"><span data-action="click->financereport#sortByLegacyMonth" class="${this.settings.lsort === 'newest' ? 'dcricon-arrow-down' : 'dcricon-arrow-up'} col-sort"></span></th>`
    } else {
      thead += `<th class="va-mid text-center ps-0 month-col border-right-grey"><span data-action="click->financereport#sortByCreateDate" class="${this.settings.tsort === 'newest' ? 'dcricon-arrow-down' : 'dcricon-arrow-up'} col-sort"></span></th>`
    }
    const usdDisp = this.settings.usd === true || this.settings.usd === 'true'
    thead += `<th class="va-mid text-right-i ps-0 fs-13i ps-3 pr-3 fw-600 treasury-content-cell">Incoming (${usdDisp ? 'USD' : 'DCR'})</th>` +
      `<th class="va-mid text-right-i ps-0 fs-13i ps-3 pr-3 fw-600 treasury-content-cell">Outgoing (${usdDisp ? 'USD' : 'DCR'})</th>` +
      `<th class="va-mid text-right-i ps-0 fs-13i ps-3 pr-3 fw-600 treasury-content-cell">Net Income (${usdDisp ? 'USD' : 'DCR'})</th>`
    if (!isLegacy) {
      thead += `<th class="va-mid text-right-i ps-0 fs-13i ps-3 pr-3 fw-600 treasury-content-cell"> Outgoing (Est)(${usdDisp ? 'USD' : 'DCR'})</th>`
    }
    thead += '</tr></thead>'
    let tbody = '<tbody>###</tbody>'
    let bodyList = ''
    // create tbody content
    let incomeTotal = 0; let outTotal = 0; let diffTotal = 0; let estimateOutTotal = 0
    for (let i = 0; i < summary.length; i++) {
      const sort = isLegacy ? this.settings.lsort : this.settings.tsort
      const index = sort === 'newest' ? i : (summary.length - i - 1)
      const item = summary[index]
      const timeParam = this.getFullTimeParam(item.month, '-')

      incomeTotal += usdDisp ? item.invalueUSD : item.invalue
      outTotal += usdDisp ? item.outvalueUSD : item.outvalue
      diffTotal += usdDisp ? item.differenceUSD : item.difference
      estimateOutTotal += usdDisp ? item.outEstimateUsd : item.outEstimate

      const incomDisplay = usdDisp ? humanize.formatToLocalString(item.invalueUSD, 2, 2) : (isLegacy ? humanize.formatToLocalString((item.invalue / 100000000), 3, 3) : humanize.formatToLocalString((item.invalue / 500000000), 3, 3))
      const outcomeDisplay = usdDisp ? humanize.formatToLocalString(item.outvalueUSD, 2, 2) : (isLegacy ? humanize.formatToLocalString((item.outvalue / 100000000), 3, 3) : humanize.formatToLocalString((item.outvalue / 500000000), 3, 3))
      const differenceDisplay = usdDisp ? humanize.formatToLocalString(item.differenceUSD, 2, 2) : (isLegacy ? humanize.formatToLocalString((item.difference / 100000000), 3, 3) : humanize.formatToLocalString((item.difference / 500000000), 3, 3))
      bodyList += '<tr>' +
        `<td class="va-mid text-center fs-13i fw-600 border-right-grey"><a class="link-hover-underline fs-13i" href="${'/finance-report/detail?type=' + this.settings.interval + '&time=' + (timeParam === '' ? item.month : timeParam)}">${item.month}</a></td>` +
        `<td class="va-mid text-right-i fs-13i treasury-content-cell">${usdDisp ? '$' : ''}${incomDisplay}</td>` +
        `<td class="va-mid text-right-i fs-13i treasury-content-cell">${usdDisp ? '$' : ''}${outcomeDisplay}</td>` +
        `<td class="va-mid text-right-i fs-13i treasury-content-cell">${usdDisp ? '$' : ''}${differenceDisplay}</td>`
      if (!isLegacy) {
        bodyList += `<td class="va-mid text-right-i fs-13i treasury-content-cell">${usdDisp ? '$' : ''}${usdDisp ? humanize.formatToLocalString(item.outEstimateUsd, 2, 2) : humanize.formatToLocalString(item.outEstimate, 3, 3)}</td>`
      }
      bodyList += '</tr>'
    }

    const totalIncomDisplay = usdDisp ? humanize.formatToLocalString(incomeTotal, 2, 2) : (isLegacy ? humanize.formatToLocalString((incomeTotal / 100000000), 3, 3) : humanize.formatToLocalString((incomeTotal / 500000000), 3, 3))
    const totalOutcomeDisplay = usdDisp ? humanize.formatToLocalString(outTotal, 2, 2) : (isLegacy ? humanize.formatToLocalString((outTotal / 100000000), 3, 3) : humanize.formatToLocalString((outTotal / 500000000), 3, 3))
    const totalDifferenceDisplay = usdDisp ? humanize.formatToLocalString(diffTotal, 2, 2) : (isLegacy ? humanize.formatToLocalString((diffTotal / 100000000), 3, 3) : humanize.formatToLocalString((diffTotal / 500000000), 3, 3))
    const totalEstimateOutgoing = usdDisp ? humanize.formatToLocalString(estimateOutTotal, 2, 2) : humanize.formatToLocalString(estimateOutTotal, 3, 3)
    bodyList += '<tr class="va-mid finance-table-header"><td class="text-center fw-600 fs-15i border-right-grey">Total</td>'
    bodyList += `<td class="va-mid text-right-i fw-600 fs-13i treasury-content-cell">${usdDisp ? '$' : ''}${totalIncomDisplay}</td>`
    bodyList += `<td class="va-mid text-right-i fw-600 fs-13i treasury-content-cell">${usdDisp ? '$' : ''}${totalOutcomeDisplay}</td>`
    bodyList += `<td class="va-mid text-right-i fw-600 fs-13i treasury-content-cell">${usdDisp ? '$' : ''}${totalDifferenceDisplay}</td>`
    if (!isLegacy) {
      bodyList += `<td class="va-mid text-right-i fw-600 fs-13i treasury-content-cell">${usdDisp ? '$' : ''}${totalEstimateOutgoing}</td>`
    }
    bodyList += '</tr>'

    tbody = tbody.replace('###', bodyList)
    return thead + tbody
  }

  // Calculate and response
  async calculate () {
    if (this.settings.type === 'treasury') {
      this.searchBoxTarget.classList.add('d-none')
      this.searchInputTarget.value = ''
      this.settings.search = this.defaultSettings.search
    } else {
      this.searchBoxTarget.classList.remove('d-none')
      this.settings.usd = false
    }
    // disabled group button for loading
    this.disabledGroupButton()
    if (!this.settings.search || this.settings.search === '') {
      let haveResponseData
      // if got report. ignore get by api
      if (this.settings.type === 'treasury') {
        if (treasuryResponse !== null) {
          responseData = treasuryResponse
          haveResponseData = true
        }
      } else if (proposalResponse !== null) {
        responseData = proposalResponse
        haveResponseData = true
      }

      if (haveResponseData) {
        this.createReportTable()
        this.enabledGroupButton()
        return
      }
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
    if (!this.settings.search || this.settings.search === '') {
      if (this.settings.type === 'treasury') {
        treasuryResponse = response
      } else {
        proposalResponse = response
      }
    }
    this.createReportTable()
    this.enabledGroupButton()
  }

  enabledGroupButton () {
    // enabled group button after loading
    this.typeTargets.forEach((typeTarget) => {
      typeTarget.disabled = false
    })
    this.intervalTargets.forEach((intervalTarget) => {
      intervalTarget.disabled = false
    })
  }

  disabledGroupButton () {
    // disabled group button after loading
    this.typeTargets.forEach((typeTarget) => {
      typeTarget.disabled = true
    })
    this.intervalTargets.forEach((intervalTarget) => {
      intervalTarget.disabled = true
    })
  }

  treasuryUsdChange (e) {
    const switchCheck = document.getElementById('usdSwitchInput').checked
    this.settings.usd = switchCheck
    this.calculate()
  }

  activeProposalSwitch (e) {
    const switchCheck = document.getElementById('activeProposalInput').checked
    this.settings.active = switchCheck
    this.calculate()
  }

  proposalReportTimeDetail (e) {
    const idArr = e.target.id.split(';')
    if (idArr.length !== 2) {
      return
    }
    window.location.href = '/finance-report/detail?type=' + idArr[0] + '&time=' + idArr[1].replace('/', '_')
  }

  get chartDuration () {
    return this.xRange[1] - this.xRange[0]
  }
}
