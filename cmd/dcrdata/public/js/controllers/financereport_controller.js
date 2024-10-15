import TurboQuery from '../helpers/turbolinks_helper'
import { requestJSON } from '../helpers/http'
import humanize from '../helpers/humanize_helper'
import { isEmpty } from 'lodash-es'
import { getDefault } from '../helpers/module_helper'
import { padPoints, sizedBarPlotter } from '../helpers/chart_helper'
import Zoom from '../helpers/zoom_helper'
import FinanceReportController from './financebase_controller.js'

const responseCache = {}
let requestCounter = 0
let responseData
let proposalResponse = null
let treasuryResponse = null
let isSearching = false
let domainChartData = null
let domainChartYearData = null
let domainYearData = null
let combinedChartData = null
let combinedChartYearData = null
let combinedData = null
let combinedAvgData = null
let combinedYearData = null
let combineBalanceMap = null
let combinedYearlyBalanceMap = null
let treasuryBalanceMap = null
let treasuryYearlyBalanceMap = null
let adminBalanceMap = null
let adminYearlyBalanceMap = null
let treasurySummaryMap = null
let redrawChart = true
let domainChartZoom
let treasuryChartZoom
let domainChartBin
let treasuryChartBin
let domainChartFlow
let treasuryChartFlow
let combinedChartZoom
let combinedChartBin
let combinedChartFlow
let adminChartZoom
let adminChartBin
let adminChartFlow

// report detail variable
const responseDetailCache = {}
let requestDetailCounter = 0
let responseDetailData
let mainReportSettingsState
let detailReportSettingsState
let mainReportInitialized = false

function hasDetailCache (k) {
  if (!responseDetailCache[k]) return false
  const expiration = new Date(responseDetailCache[k].expiration)
  return expiration > new Date()
}

const proposalNote = '*The data is the daily cost estimate based on the total budget divided by the total number of proposals days.'
let treasuryNote = ''

function hasCache (k) {
  if (!responseCache[k]) return false
  const expiration = new Date(responseCache[k].expiration)
  return expiration > new Date()
}

// start function and variable for chart
const blockDuration = 5 * 60000
let Dygraph // lazy loaded on connect

function txTypesFunc (d, binSize) {
  const p = []

  d.time.map((n, i) => {
    p.push([new Date(n), d.sentRtx[i], d.receivedRtx[i], d.tickets[i], d.votes[i], d.revokeTx[i]])
  })

  padPoints(p, binSize)

  return p
}

function amountFlowProcessor (d, binSize) {
  const flowData = []
  const balanceData = []
  let balance = 0

  d.time.map((n, i) => {
    const v = d.net[i]
    let netReceived = 0
    let netSent = 0

    v > 0 ? (netReceived = v) : (netSent = (v * -1))
    flowData.push([new Date(n), d.received[i], d.sent[i], netReceived, netSent])
    balance += v
    balanceData.push([new Date(n), balance])
  })

  padPoints(flowData, binSize)
  padPoints(balanceData, binSize, true)

  return {
    flow: flowData,
    balance: balanceData
  }
}

function domainChartProcessor (d, binSize) {
  const flowData = []

  d.time.map((n, i) => {
    flowData.push([new Date(n), d.marketing[i], d.development[i]])
  })

  padPoints(flowData, binSize)

  return {
    flow: flowData
  }
}

function customizedFormatter (data) {
  let xHTML = ''
  if (data.xHTML !== undefined) {
    xHTML = humanize.date(data.x, false, true)
  }
  let html = this.getLabels()[0] + ': ' + xHTML
  data.series.map((series) => {
    if (series.color === undefined) return ''
    // Skip display of zeros
    if (series.y === 0) return ''
    const l = '<span style="color: ' + series.color + ';"> ' + series.labelHTML
    html = '<span style="color:#2d2d2d;">' + html + '</span>'
    html += '<br>' + series.dashHTML + l + ': ' + (isNaN(series.y) ? '' : series.y + ' DCR') + '</span> '
  })
  return html
}

function domainChartFormatter (data) {
  let xHTML = ''
  if (data.xHTML !== undefined) {
    xHTML = humanize.date(data.x, false, true)
  }
  let html = this.getLabels()[0] + ': ' + xHTML
  data.series.map((series) => {
    if (series.color === undefined) return ''
    // Skip display of zeros
    if (series.y === 0) return ''
    const l = '<span style="color: ' + series.color + ';"> ' + series.labelHTML
    html = '<span style="color:#2d2d2d;">' + html + '</span>'
    html += '<br>' + series.dashHTML + l + ': $' + (isNaN(series.y) ? '' : humanize.formatToLocalString(Number(series.y), 2, 2)) + '</span> '
  })
  return html
}

let commonOptions, amountFlowGraphOptions, balanceGraphOptions, domainGraphOptions
// Cannot set these until DyGraph is fetched.
function createOptions () {
  commonOptions = {
    digitsAfterDecimal: 8,
    showRangeSelector: true,
    rangeSelectorHeight: 20,
    rangeSelectorForegroundStrokeColor: '#999',
    rangeSelectorBackgroundStrokeColor: '#777',
    legend: 'follow',
    fillAlpha: 0.9,
    labelsKMB: true,
    labelsUTC: true,
    stepPlot: false,
    rangeSelectorPlotFillColor: 'rgba(128, 128, 128, 0.3)',
    rangeSelectorPlotFillGradientColor: 'transparent',
    rangeSelectorPlotStrokeColor: 'rgba(128, 128, 128, 0.7)',
    rangeSelectorPlotLineWidth: 2
  }

  amountFlowGraphOptions = {
    labels: ['Date', 'Income', 'Outgoing', 'Net Received', 'Net Spent'],
    colors: ['#2971FF', '#2ED6A1', '#41BF53', '#FF0090'],
    ylabel: 'Total (DCR)',
    visibility: [true, false, false, false],
    legendFormatter: customizedFormatter,
    stackedGraph: true,
    fillGraph: false
  }

  domainGraphOptions = {
    labels: ['Date', 'Marketing', 'Development'],
    colors: ['#2971FF', '#2ED6A1'],
    ylabel: 'Total Spend (USD)',
    visibility: [true, true],
    legendFormatter: domainChartFormatter,
    stackedGraph: true,
    fillGraph: false
  }

  balanceGraphOptions = {
    labels: ['Date', 'Balance'],
    colors: ['#41BF53'],
    ylabel: 'Balance (DCR)',
    plotter: [Dygraph.Plotters.linePlotter, Dygraph.Plotters.fillPlotter],
    legendFormatter: customizedFormatter,
    stackedGraph: false,
    visibility: [true],
    fillGraph: true,
    stepPlot: true
  }
}

let ctrl = null
// end function and varibable for chart

export default class extends FinanceReportController {
  static get targets () {
    return ['report', 'colorNoteRow', 'colorLabel', 'colorDescription',
      'interval', 'groupBy', 'searchInput', 'searchBtn', 'clearSearchBtn', 'searchBox', 'nodata',
      'treasuryToggleArea', 'reportDescription', 'reportAllPage',
      'activeProposalSwitchArea', 'options', 'flow', 'zoom', 'cinterval', 'chartbox', 'noconfirms',
      'chart', 'chartLoader', 'expando', 'littlechart', 'bigchart', 'fullscreen', 'treasuryChart', 'treasuryChartTitle',
      'yearSelect', 'ttype', 'yearSelectTitle', 'treasuryTypeTitle', 'groupByLabel', 'typeSelector',
      'amountFlowOption', 'balanceOption', 'chartHeader', 'outgoingExp', 'nameMatrixSwitch',
      'weekZoomBtn', 'dayZoomBtn', 'weekGroupBtn', 'dayGroupBtn', 'sentRadioLabel', 'receivedRadioLabel',
      'netSelectRadio', 'selectTreasuryType', 'proposalSelectType', 'proposalType', 'listLabel', 'monthLabel',
      'currentBalanceArea', 'treasuryBalanceDisplay', 'treasuryLegacyPercent', 'treasuryTypeRate', 'chartData',
      'specialTreasury', 'decentralizedData', 'adminData', 'domainFutureRow', 'futureLabel', 'reportType', 'pageLoader',
      'treasuryBalanceRate', 'treasuryLegacyRate', 'decentralizedDataRate', 'adminDataRate', 'decentralizedTitle', 'adminTitle',
      'treasuryBalanceCard', 'subTreasuryTitle', 'noDetailData', 'reportArea', 'detailReportArea', 'mainReportTopArea', 'proposalSumCard',
      'proposalSpanRow', 'toVote', 'toDiscussion', 'totalSpanRow', 'expendiduteValue', 'yearMonthInfoTable', 'noReport', 'domainArea',
      'domainReport', 'proposalArea', 'proposalReport', 'monthlyArea', 'monthlyReport', 'yearlyArea', 'yearlyReport', 'sameOwnerProposalArea',
      'otherProposalSummary', 'summaryArea', 'summaryReport', 'reportParentContainer', 'yearMonthSelector', 'topYearSelect', 'topMonthSelect',
      'detailReportTitle', 'prevBtn', 'nextBtn', 'proposalTopSummary', 'domainSummaryTable', 'domainSummaryArea', 'proposalSpent',
      'treasurySpent', 'unaccountedValue', 'proposalSpentArea', 'treasurySpentArea', 'unaccountedValueArea', 'viewMode', 'useMonthAvgToggle']
  }

  async connectData () {
    ctrl = this
    ctrl.retrievedData = {}
    ctrl.ajaxing = false
    ctrl.requestedChart = false
    // Bind functions that are passed as callbacks
    ctrl.zoomCallback = ctrl._zoomCallback.bind(ctrl)
    ctrl.drawCallback = ctrl._drawCallback.bind(ctrl)
    ctrl.lastEnd = 0
    ctrl.bindElements()
    if (this.settings.type === 'bytime') {
      return
    }
    // These two are templates for query parameter sets.
    // When url query parameters are set, these will also be updated.
    ctrl.state = Object.assign({}, ctrl.settings)

    // Parse stimulus data
    const cdata = ctrl.data
    ctrl.dcrAddress = cdata.get('dcraddress')
    ctrl.balance = cdata.get('balance')

    if (ctrl.isTreasuryReport()) {
      ctrl.settings.zoom = ctrl.getTreasuryZoomStatus()
      ctrl.settings.bin = ctrl.getTreasuryBinStatus()
      ctrl.settings.flow = ctrl.getTreasuryFlowStatus()
    } else if (ctrl.isDomainType()) {
      ctrl.settings.zoom = domainChartZoom || ctrl.settings.zoom
      ctrl.settings.bin = domainChartBin || ctrl.settings.bin
      ctrl.settings.flow = domainChartFlow || ctrl.settings.flow
    } else {
      ctrl.settings.zoom = ''
      ctrl.settings.bin = ctrl.defaultSettings.bin
      ctrl.settings.flow = ctrl.defaultSettings.flow
    }
    if (ctrl.isNullValue(ctrl.optionsTarget.value)) {
      ctrl.optionsTarget.value = 'balance'
    }
    // Get initial view settings from the url
    ctrl.setChartType()
    if (!ctrl.isNullValue(ctrl.settings.flow)) {
      ctrl.setFlowChecks()
    } else {
      ctrl.settings.flow = ctrl.defaultSettings.flow
      ctrl.setFlowChecks()
    }
    if (!ctrl.isNullValue(ctrl.settings.zoom)) {
      ctrl.zoomButtons.forEach((button) => {
        button.classList.remove('btn-selected')
      })
    }
    if (ctrl.isNullValue(ctrl.settings.bin)) {
      ctrl.settings.bin = ctrl.getBin()
    }
    if (ctrl.isNullValue(ctrl.settings.chart) || !ctrl.validChartType(ctrl.settings.chart)) {
      ctrl.settings.chart = ctrl.chartType
    }
    Dygraph = await getDefault(
      import('../vendor/dygraphs.min.js')
    )
    ctrl.currentTType = ctrl.settings.ttype
    ctrl.changedTType = null
    this.calculate()
  }

  getTreasuryZoomStatus () {
    switch (this.settings.ttype) {
      case 'current':
        return treasuryChartZoom || this.settings.zoom
      case 'legacy':
        return adminChartZoom || this.settings.zoom
      default:
        return combinedChartZoom || this.settings.zoom
    }
  }

  getTreasuryBinStatus () {
    switch (this.settings.ttype) {
      case 'current':
        return treasuryChartBin || this.settings.bin
      case 'legacy':
        return adminChartBin || this.settings.bin
      default:
        return combinedChartBin || this.settings.bin
    }
  }

  getTreasuryFlowStatus () {
    switch (this.settings.ttype) {
      case 'current':
        return treasuryChartFlow || this.settings.flow
      case 'legacy':
        return adminChartFlow || this.settings.flow
      default:
        return combinedChartFlow || this.settings.flow
    }
  }

  setTreasuryZoomStatus (zoom) {
    switch (this.settings.ttype) {
      case 'current':
        treasuryChartZoom = zoom
        break
      case 'legacy':
        adminChartZoom = zoom
        break
      default:
        combinedChartZoom = zoom
    }
  }

  setTreasuryBinStatus (bin) {
    switch (this.settings.ttype) {
      case 'current':
        treasuryChartBin = bin
        break
      case 'legacy':
        adminChartBin = bin
        break
      default:
        combinedChartBin = bin
    }
  }

  setTreasuryFlowStatus (flow) {
    switch (this.settings.ttype) {
      case 'current':
        treasuryChartFlow = flow
        break
      case 'legacy':
        adminChartFlow = flow
        break
      default:
        combinedChartFlow = flow
    }
  }

  _drawCallback (graph, first) {
    if (first) return
    const [start, end] = ctrl.graph.xAxisRange()
    if (start === end) return
    if (end === this.lastEnd) return // Only handle slide event.
    this.lastEnd = end
    ctrl.settings.zoom = Zoom.encode(start, end)
    if (ctrl.isTreasuryReport()) {
      ctrl.setTreasuryZoomStatus(ctrl.settings.zoom)
    } else if (ctrl.isDomainType()) {
      domainChartZoom = ctrl.settings.zoom
    }
    ctrl.updateQueryString()
    ctrl.setSelectedZoom(Zoom.mapKey(ctrl.settings.zoom, ctrl.graph.xAxisExtremes()))
  }

  _zoomCallback (start, end) {
    ctrl.zoomButtons.forEach((button) => {
      button.classList.remove('btn-selected')
    })
    ctrl.settings.zoom = Zoom.encode(start, end)
    if (ctrl.isTreasuryReport()) {
      ctrl.setTreasuryZoomStatus(ctrl.settings.zoom)
    } else if (ctrl.isDomainType()) {
      domainChartZoom = ctrl.settings.zoom
    }
    ctrl.updateQueryString()
    ctrl.setSelectedZoom(Zoom.mapKey(ctrl.settings.zoom, ctrl.graph.xAxisExtremes()))
  }

  setSelectedZoom (zoomKey) {
    this.zoomButtons.forEach(function (button) {
      if (button.name === zoomKey) {
        button.classList.add('btn-selected')
      } else {
        button.classList.remove('btn-selected')
      }
    })
  }

  drawGraph () {
    const settings = ctrl.settings
    ctrl.noconfirmsTarget.classList.add('d-hide')
    ctrl.chartTarget.classList.remove('d-hide')
    // Check for invalid view parameters
    if (!ctrl.validChartType(settings.chart) || !ctrl.validGraphInterval()) return
    if (settings.chart === ctrl.state.chart && settings.bin === ctrl.state.bin) {
      // Only the zoom has changed.
      const zoom = Zoom.decode(settings.zoom)
      if (zoom) {
        ctrl.setZoom(zoom.start, zoom.end)
      }
      return
    }
    // Set the current view to prevent unnecessary reloads.
    Object.assign(ctrl.state, settings)
    if (ctrl.isTreasuryReport()) {
      ctrl.setTreasuryZoomStatus(settings.zoom)
      ctrl.setTreasuryBinStatus(settings.bin)
      ctrl.setTreasuryFlowStatus(settings.flow)
    } else if (ctrl.isDomainType()) {
      domainChartZoom = settings.zoom
      domainChartBin = settings.bin
      domainChartFlow = settings.flow
    }
    ctrl.fetchGraphData(settings.chart, settings.bin)
  }

  setIntervalButton (interval) {
    const button = ctrl.validGraphInterval(interval)
    if (!button) return false
    ctrl.binputs.forEach((button) => {
      button.classList.remove('btn-selected')
    })
    button.classList.add('btn-selected')
  }

  validGraphInterval (interval) {
    const bin = interval || this.settings.bin || this.activeBin
    let b = false
    this.binputs.forEach((button) => {
      if (button.name === bin) b = button
    })
    return b
  }

  getBin () {
    let bin = ctrl.query.get('bin')
    if (!ctrl.setIntervalButton(bin)) {
      bin = ctrl.activeBin
    }
    return bin
  }

  setFlowChecks () {
    const bitmap = this.settings.flow
    this.flowBoxes.forEach((box) => {
      box.checked = bitmap & parseInt(box.value)
    })
  }

  disconnect () {
    if (this.graph !== undefined) {
      this.graph.destroy()
    }
    this.retrievedData = {}
  }

  validChartType (chart) {
    return this.optionsTarget.namedItem(chart) || false
  }

  setChartType () {
    const chart = this.settings.chart
    if (this.validChartType(chart)) {
      this.optionsTarget.value = chart
    }
  }

  // Request the initial chart data, grabbing the Dygraph script if necessary.
  initializeChart () {
    createOptions()
    // If no chart data has been requested, e.g. when initially on the
    // list tab, then fetch the initial chart data.
    this.fetchGraphData(this.chartType, this.getBin())
  }

  async fetchGraphData (chart, bin) {
    const cacheKey = chart + '-' + bin
    if (ctrl.ajaxing === cacheKey) {
      return
    }
    ctrl.requestedChart = cacheKey
    ctrl.ajaxing = cacheKey

    ctrl.chartLoaderTarget.classList.add('loading')
    // if not change type
    if (this.isDomainType() || (!ctrl.currentTType && ctrl.currentTType === ctrl.changedTType)) {
      // Check for cached data
      if (ctrl.retrievedData[cacheKey]) {
        // Queue the function to allow the loader to display.
        setTimeout(() => {
          ctrl.popChartCache(chart, bin)
          ctrl.chartLoaderTarget.classList.remove('loading')
          ctrl.ajaxing = false
        }, 10) // 0 should work but doesn't always
        return
      }
    }
    // if else, get data from api
    let graphDataResponse = null
    if (this.settings.type === 'treasury' && (bin === 'week' || bin === 'day') && this.settings.ttype !== 'current' && this.settings.ttype !== 'legacy') {
      const treasuryUrl = `/api/treasury/io/${bin}`
      const legacyUrl = '/api/address/' + ctrl.devAddress + '/amountflow/' + bin
      const treasuryRes = await requestJSON(treasuryUrl)
      const legacyRes = await requestJSON(legacyUrl)
      graphDataResponse = this.combinedDataHandler(treasuryRes, legacyRes)
    } else {
      let url = `/api/treasury/io/${bin}`
      if (!this.isDomainType() && this.settings.ttype === 'legacy') {
        url = '/api/address/' + ctrl.devAddress + '/amountflow/' + bin
      }
      graphDataResponse = this.isDomainType() ? (bin === 'year' ? domainChartYearData : domainChartData) : (this.settings.ttype !== 'current' && this.settings.ttype !== 'legacy') ? (bin === 'year' ? combinedChartYearData : combinedChartData) : await requestJSON(url)
    }
    ctrl.processData(chart, bin, graphDataResponse)
    this.currentTType = this.changedTType
    ctrl.ajaxing = false
    ctrl.chartLoaderTarget.classList.remove('loading')
  }

  isDomainType () {
    return (this.settings.type === '' || this.settings.type === 'proposal' || this.settings.type === 'summary') && this.settings.pgroup === 'domains'
  }

  combinedDataHandler (treasuryRes, legacyRes) {
    // create time map
    const timeArr = []
    // return combined data
    const combinedDataMap = new Map()
    const _this = this
    if (treasuryRes && treasuryRes.time) {
      treasuryRes.time.map((time, index) => {
        const dateTime = new Date(time)
        const dateTimeStr = _this.getStringFromDate(dateTime)
        timeArr.push(dateTimeStr)
        const item = {
          time: dateTimeStr,
          received: treasuryRes.received[index],
          sent: treasuryRes.sent[index],
          net: treasuryRes.net[index]
        }
        combinedDataMap.set(dateTimeStr, item)
      })
    }

    if (legacyRes && legacyRes.time) {
      legacyRes.time.map((time, index) => {
        const dateTime = new Date(time)
        const dateTimeStr = _this.getStringFromDate(dateTime)
        if (!timeArr.includes(dateTimeStr)) {
          timeArr.push(dateTimeStr)
          const item = {
            time: dateTimeStr,
            received: legacyRes.received[index],
            sent: legacyRes.sent[index],
            net: legacyRes.net[index]
          }
          combinedDataMap.set(dateTimeStr, item)
        } else {
          const item = combinedDataMap.get(dateTimeStr)
          item.received = Number(item.received) + Number(legacyRes.received[index])
          item.sent = Number(item.sent) + Number(legacyRes.sent[index])
          item.net = Number(item.net) + Number(legacyRes.net[index])
          combinedDataMap.set(dateTimeStr, item)
        }
      })
    }

    timeArr.sort(function (a, b) {
      const aTime = new Date(a)
      const bTime = new Date(b)
      if (aTime > bTime) {
        return 1
      }
      if (aTime < bTime) {
        return -1
      }
      return 0
    })

    const timeInsertArr = []
    const receivedArr = []
    const sentArr = []
    const netArr = []
    timeArr.forEach((time) => {
      timeInsertArr.push(time + 'T07:00:00Z')
      const item = combinedDataMap.get(time)
      receivedArr.push(item.received)
      sentArr.push(item.sent)
      netArr.push(item.net)
    })
    const mainResult = {
      time: timeInsertArr,
      received: receivedArr,
      sent: sentArr,
      net: netArr
    }
    return mainResult
  }

  getStringFromDate (date) {
    let result = date.getFullYear() + '-'
    const month = date.getMonth() + 1
    result += (month < 10 ? '0' + month : month) + '-'
    const day = date.getDate()
    result += day < 10 ? '0' + day : day
    return result
  }

  processData (chart, bin, data) {
    if (isEmpty(data)) {
      ctrl.noDataAvailable()
      return
    }
    const binSize = Zoom.mapValue(bin) || blockDuration
    if (chart === 'types') {
      ctrl.retrievedData['types-' + bin] = txTypesFunc(data, binSize)
    } else if (chart === 'amountflow' || chart === 'balance') {
      const processed = this.isDomainType() ? domainChartProcessor(data, binSize) : amountFlowProcessor(data, binSize)
      ctrl.retrievedData['amountflow-' + bin] = processed.flow
      if (!ctrl.isDomainType()) {
        ctrl.retrievedData['balance-' + bin] = processed.balance
      }
    } else return
    setTimeout(() => {
      ctrl.popChartCache(chart, bin)
    }, 0)
  }

  noDataAvailable () {
    this.noconfirmsTarget.classList.remove('d-hide')
    this.chartTarget.classList.add('d-hide')
    this.chartLoaderTarget.classList.remove('loading')
  }

  popChartCache (chart, bin) {
    const cacheKey = chart + '-' + bin
    const binSize = Zoom.mapValue(bin) || blockDuration
    if (!ctrl.retrievedData[cacheKey] ||
      ctrl.requestedChart !== cacheKey
    ) {
      return
    }
    const data = ctrl.retrievedData[cacheKey]
    let options = null
    ctrl.flowTarget.classList.add('d-hide')
    switch (chart) {
      case 'amountflow':
        options = this.isDomainType() ? domainGraphOptions : amountFlowGraphOptions
        options.plotter = sizedBarPlotter(binSize)
        ctrl.flowTarget.classList.remove('d-hide')
        break
      case 'balance':
        options = balanceGraphOptions
        break
    }
    options.zoomCallback = null
    options.drawCallback = null
    if (ctrl.graph === undefined) {
      ctrl.graph = ctrl.createGraph(data, options)
    } else {
      ctrl.graph.updateOptions({
        ...{ file: data },
        ...options
      })
    }
    if (chart === 'amountflow') {
      ctrl.updateFlow()
    }
    ctrl.chartLoaderTarget.classList.remove('loading')
    ctrl.xRange = ctrl.graph.xAxisExtremes()
    ctrl.validateZoom(binSize)
  }

  changeBin (e) {
    const target = e.srcElement || e.target
    if (target.nodeName !== 'BUTTON') return
    ctrl.settings.bin = target.name
    ctrl.setIntervalButton(target.name)
    this.handlerBinSelectorWhenChange()
    if (target.name === 'year') {
      if (ctrl.zoomButtons) {
        ctrl.zoomButtons.forEach((button) => {
          if (button.name === 'all') {
            button.click()
          }
        })
      }
    }
    this.updateQueryString()
    this.drawGraph()
  }

  changeGraph (e) {
    this.settings.chart = this.chartType
    if (this.settings.type === 'treasury') {
      this.treasuryChart = this.settings.chart
    }
    this.updateQueryString()
    this.drawGraph()
  }

  validateZoom (binSize) {
    ctrl.setButtonVisibility()
    const zoom = Zoom.validate(ctrl.activeZoomKey || ctrl.settings.zoom, ctrl.xRange, binSize)
    ctrl.setZoom(zoom.start, zoom.end)
    ctrl.graph.updateOptions({
      zoomCallback: ctrl.zoomCallback,
      drawCallback: ctrl.drawCallback
    })
  }

  setZoom (start, end) {
    ctrl.chartLoaderTarget.classList.add('loading')
    ctrl.graph.updateOptions({
      dateWindow: [start, end]
    })
    ctrl.settings.zoom = Zoom.encode(start, end)
    ctrl.lastEnd = end
    ctrl.updateQueryString()
    ctrl.chartLoaderTarget.classList.remove('loading')
  }

  onZoom (e) {
    const target = e.srcElement || e.target
    if (target.nodeName !== 'BUTTON') return
    ctrl.zoomButtons.forEach((button) => {
      button.classList.remove('btn-selected')
    })
    target.classList.add('btn-selected')
    if (ctrl.graph === undefined) {
      return
    }

    this.handlerAllowChartSelector()
    const duration = ctrl.activeZoomDuration
    const end = ctrl.xRange[1]
    const start = duration === 0 ? ctrl.xRange[0] : end - duration
    ctrl.setZoom(start, end)
    if (ctrl.isTreasuryReport()) {
      ctrl.setTreasuryZoomStatus(ctrl.settings.zoom)
    } else if (ctrl.isDomainType()) {
      domainChartZoom = ctrl.settings.zoom
    }
  }

  handlerBinSelectorWhenChange () {
    switch (this.activeBin) {
      case 'all':
        this.handlerZoomDisabledBySelector(['all'])
        break
      default:
        this.handlerZoomDisabledBySelector([])
    }
  }

  handlerZoomDisabledBySelector (disabledTypes) {
    this.zoomButtons.forEach((button) => {
      if (disabledTypes.includes(button.name)) {
        button.disabled = true
      } else {
        button.disabled = false
      }
    })
  }

  handlerAllowChartSelector () {
    const activeButtons = this.zoomTarget.getElementsByClassName('btn-selected')
    if (activeButtons.length === 0) return
    const activeZoomType = activeButtons[0].name
    switch (activeZoomType) {
      case 'all':
        if (this.activeBin === 'all') {
          ctrl.binputs.forEach((button) => {
            if (button.name === 'year') {
              button.click()
            }
          })
        }
        this.handlerGroupDisabledBySelector(['all'])
        break
      case 'year':
        this.handlerGroupDisabledBySelector([])
        break
      case 'month':
        // if current group type is year, change to month
        if (this.activeBin === 'year') {
          ctrl.binputs.forEach((button) => {
            if (button.name === 'month') {
              button.click()
            }
          })
        }
        this.handlerGroupDisabledBySelector(['year'])
        break
      case 'week':
        if (this.activeBin === 'year' || this.activeBin === 'month') {
          ctrl.binputs.forEach((button) => {
            if (button.name === 'week') {
              button.click()
            }
          })
        }
        this.handlerGroupDisabledBySelector(['year', 'month'])
        break
      case 'day':
        if (this.activeBin === 'year' || this.activeBin === 'month' || this.activeBin === 'week') {
          ctrl.binputs.forEach((button) => {
            if (button.name === 'day') {
              button.click()
            }
          })
        }
        this.handlerGroupDisabledBySelector(['year', 'month', 'week'])
        break
    }
  }

  handlerGroupDisabledBySelector (disabledTypes) {
    this.binputs.forEach((button) => {
      if (disabledTypes.includes(button.name)) {
        button.disabled = true
      } else {
        button.disabled = false
      }
    })
  }

  toggleExpand (e) {
    const btn = this.expandoTarget
    if (btn.classList.contains('dcricon-expand')) {
      btn.classList.remove('dcricon-expand')
      btn.classList.add('dcricon-collapse')
      this.bigchartTarget.appendChild(this.chartboxTarget)
      this.fullscreenTarget.classList.remove('d-none')
    } else {
      this.putChartBack()
    }
    if (this.graph) this.graph.resize()
  }

  putChartBack () {
    const btn = this.expandoTarget
    btn.classList.add('dcricon-expand')
    btn.classList.remove('dcricon-collapse')
    this.littlechartTarget.appendChild(this.chartboxTarget)
    this.fullscreenTarget.classList.add('d-none')
    if (this.graph) this.graph.resize()
  }

  exitFullscreen (e) {
    if (e.target !== this.fullscreenTarget) return
    this.putChartBack()
  }

  setButtonVisibility () {
    const duration = ctrl.chartDuration
    const buttonSets = [ctrl.zoomButtons, ctrl.binputs]
    buttonSets.forEach((buttonSet) => {
      buttonSet.forEach((button) => {
        if (button.dataset.fixed) return
        if (duration > Zoom.mapValue(button.name)) {
          button.classList.remove('d-hide')
        } else {
          button.classList.remove('btn-selected')
          button.classList.add('d-hide')
        }
      })
    })
  }

  updateFlow () {
    const bitmap = ctrl.flow
    if (bitmap === 0) {
      // If all boxes are unchecked, just leave the last view
      // in place to prevent chart errors with zero visible datasets
      return
    }
    ctrl.settings.flow = bitmap
    ctrl.updateQueryString()
    // Set the graph dataset visibility based on the bitmap
    // Dygraph dataset indices: 0 received, 1 sent, 2 & 3 net
    const visibility = {}
    visibility[0] = bitmap & 1
    visibility[1] = bitmap & 2
    visibility[2] = visibility[3] = bitmap & 4
    Object.keys(visibility).forEach((idx) => {
      ctrl.graph.setVisibility(idx, visibility[idx])
    })
  }

  createGraph (processedData, otherOptions) {
    return new Dygraph(
      this.chartTarget,
      processedData,
      { ...commonOptions, ...otherOptions }
    )
  }

  bindElements () {
    this.flowBoxes = this.flowTarget.querySelectorAll('input')
    this.zoomButtons = this.zoomTarget.querySelectorAll('button')
    this.binputs = this.cintervalTarget.querySelectorAll('button')
  }

  async initialize () {
    this.query = new TurboQuery()
    this.settings = TurboQuery.nullTemplate([
      'chart', 'zoom', 'bin', 'flow', 'type', 'tsort', 'psort', 'stype',
      'order', 'interval', 'search', 'usd', 'active', 'year', 'ttype', 'pgroup',
      'ptype', 'dtype', 'dtime', 'dtoken', 'dname', 'dstype', 'dorder', 'tavg'])
    this.politeiaUrl = this.data.get('politeiaUrl')
    this.defaultSettings = {
      type: 'proposal',
      tsort: 'newest',
      psort: 'newest',
      pgroup: 'proposals',
      stype: 'startdt',
      order: 'desc',
      interval: 'month',
      ptype: 'month',
      search: '',
      usd: false,
      active: true,
      chart: 'amountflow',
      zoom: '',
      bin: 'month',
      flow: 3,
      year: 0, // 0 when display all year
      ttype: 'combined',
      dtype: 'year',
      dtime: '',
      dtoken: '',
      dname: '',
      dstype: 'pname',
      dorder: 'desc',
      tavg: false
    }
    mainReportInitialized = false
    detailReportSettingsState = undefined
    mainReportSettingsState = undefined
    this.query.update(this.settings)
    if (this.isNullValue(this.settings.type)) {
      this.settings.type = this.defaultSettings.type
    }
    await this.initReportTimeRange()
    if (this.settings.type === 'bytime') {
      this.initReportDetailData()
      this.connectData()
      return
    }
    await this.initMainFinancialReport()
    await this.connectData()
  }

  async initMainFinancialReport () {
    this.treasuryChart = 'balance'
    this.proposalTSort = 'oldest'
    this.treasuryTSort = 'newest'
    this.isMonthDisplay = false
    this.useMonthAvg = false
    this.devAddress = this.data.get('devAddress')
    treasuryNote = `*All numbers are pulled from the blockchain. Includes <a href="/treasury" data-turbolinks="false">treasury</a> and <a href="/address/${this.devAddress}" data-turbolinks="false">legacy</a> data.`
    redrawChart = true
    domainChartZoom = undefined
    treasuryChartZoom = undefined
    combinedChartZoom = undefined
    adminChartZoom = undefined
    domainChartBin = undefined
    treasuryChartBin = undefined
    combinedChartBin = undefined
    adminChartBin = undefined
    domainChartFlow = undefined
    treasuryChartFlow = undefined
    combinedChartFlow = undefined
    adminChartFlow = undefined
    isSearching = false
    await this.initData()
    this.initScrollerForTable()
    this.isMonthDisplay = this.isTreasuryReport() || this.isDomainType() ? true : this.isProposalMonthReport() || this.isAuthorMonthGroup()
    this.useMonthAvg = this.settings.tavg
    document.getElementById('useMonthAvg').checked = this.useMonthAvg
    const tooltipElements = document.getElementsByClassName('cell-tooltip')
    document.addEventListener('click', function (event) {
      for (let i = 0; i < tooltipElements.length; i++) {
        const popEl = tooltipElements[i]
        const isClickInside = popEl.contains(event.target)
        // if click outside, add hidden to all tooltiptext element
        const tooltiptext = popEl.getElementsByClassName('tooltiptext')[0]
        if (!tooltiptext) {
          continue
        }
        if (!isClickInside) {
          popEl.classList.remove('active')
          tooltiptext.style.visibility = 'hidden'
        }
      }
    })
    mainReportInitialized = true
  }

  initYearMonthSelector () {
    // handle month year of dtime
    let selectedYear = -1
    let selectedMonth = 0
    if (this.settings.dtime && this.settings.dtime !== '') {
      const timeArr = this.settings.dtime.toString().split('_')
      selectedYear = Number(timeArr[0])
      if (timeArr.length > 1) {
        selectedMonth = Number(timeArr[1])
      }
    }
    selectedYear = selectedYear <= 0 ? this.reportMaxYear : selectedYear
    let yearOptions = ''
    for (let i = this.reportMaxYear; i >= this.reportMinYear; i--) {
      yearOptions += `<option name="year_${i}" value="${i}" ${selectedYear === i ? 'selected' : ''}>${i}</option>`
    }
    this.topYearSelectTarget.innerHTML = yearOptions

    // init month selector
    let minMonth = 1
    let maxMonth = 12
    if (selectedYear === this.reportMinYear) {
      minMonth = this.reportMinMonth
    }
    if (selectedYear === this.reportMaxYear) {
      maxMonth = this.reportMaxMonth
    }
    selectedMonth = selectedMonth < 0 ? maxMonth : selectedMonth
    let monthOptions = `<option name="month_all" value="0" ${selectedMonth === 0 ? 'selected' : ''}>All Months</option>`
    for (let i = maxMonth; i >= minMonth; i--) {
      monthOptions += `<option name="month_${i}" value="${i}" ${selectedMonth === i ? 'selected' : ''}>${this.getMonthDisplay(i)}</option>`
    }
    this.topMonthSelectTarget.innerHTML = monthOptions
    const timeIntArr = this.getDetailYearMonth()
    // init for prev, next buttons
    let prevBtnShow = true
    let nextBtnShow = true
    if (this.isYearDetailReport()) {
      if (timeIntArr[0] === this.reportMinYear) {
        prevBtnShow = false
      }
      if (timeIntArr[0] === this.reportMaxYear) {
        nextBtnShow = false
      }
    } else if (this.isMonthDetailReport()) {
      if (timeIntArr[0] === this.reportMinYear && timeIntArr[1] === this.reportMinMonth) {
        prevBtnShow = false
      }
      if (timeIntArr[0] === this.reportMaxYear && timeIntArr[1] === this.reportMaxMonth) {
        nextBtnShow = false
      }
    }
    if (prevBtnShow) {
      this.prevBtnTarget.classList.remove('disabled')
      this.prevBtnTarget.classList.add('cursor-pointer')
    } else {
      this.prevBtnTarget.classList.add('disabled')
      this.prevBtnTarget.classList.remove('cursor-pointer')
    }
    if (nextBtnShow) {
      this.nextBtnTarget.classList.remove('disabled')
      this.nextBtnTarget.classList.add('cursor-pointer')
    } else {
      this.nextBtnTarget.classList.add('disabled')
      this.nextBtnTarget.classList.remove('cursor-pointer')
    }
  }

  initReportDetailData () {
    this.reportTypeTargets.forEach((rTypeTarget) => {
      rTypeTarget.classList.remove('active')
      if (rTypeTarget.name === 'bytime') {
        rTypeTarget.classList.add('active')
      }
    })
    this.viewModeTarget.classList.add('d-none')
    this.detailReportAreaTarget.classList.remove('d-none')
    this.mainReportTopAreaTarget.classList.add('d-none')
    this.reportParentContainerTarget.classList.add('d-none')
    this.proposalSelectTypeTarget.classList.add('d-none')
    this.selectTreasuryTypeTarget.classList.add('d-none')
    this.yearMonthSelectorTarget.classList.remove('d-none')
    if (this.isNullValue(this.settings.dorder)) {
      this.settings.dorder = this.defaultSettings.dorder
    }
    if (this.isNullValue(this.settings.dtype)) {
      this.settings.dtype = this.defaultSettings.dtype
    }
    if (this.isNullValue(this.settings.dtime)) {
      // init dtime is now
      const now = new Date()
      const year = now.getFullYear()
      const month = now.getMonth() + 1
      let time = year
      if (this.settings.dtype === 'month') {
        time = time + '_' + month
      }
      this.settings.dtime = time
    } else {
      if (this.settings.dtime.toString().includes('_')) {
        this.settings.dtype = 'month'
      } else {
        this.settings.dtype = 'year'
      }
    }
    // init for detail report title
    const timeArr = this.settings.dtime.toString().split('_')
    this.detailReportTitleTarget.textContent = (this.isYearDetailReport() ? 'Yearly Report - ' : 'Monthly Report - ') + (timeArr.length > 1 && this.settings.dtype === 'month' ? this.getMonthDisplay(Number(timeArr[1])) + ' ' : '') + timeArr[0]
    // init year month selector
    this.initYearMonthSelector()
    this.updateQueryString()
    this.noDetailDataTarget.classList.add('d-none')
    this.reportAreaTarget.classList.remove('d-none')
    this.yearMonthCalculate()
  }

  getMonthDisplay (month) {
    switch (month) {
      case 1:
        return 'January'
      case 2:
        return 'February'
      case 3:
        return 'March'
      case 4:
        return 'April'
      case 5:
        return 'May'
      case 6:
        return 'June'
      case 7:
        return 'July'
      case 8:
        return 'August'
      case 9:
        return 'September'
      case 10:
        return 'October'
      case 11:
        return 'November'
      case 12:
        return 'December'
      default:
        return ''
    }
  }

  async initData () {
    this.detailReportAreaTarget.classList.add('d-none')
    this.mainReportTopAreaTarget.classList.remove('d-none')
    this.yearMonthSelectorTarget.classList.add('d-none')
    this.reportParentContainerTarget.classList.remove('d-none')
    this.viewModeTarget.classList.remove('d-none')
    if ((this.isNullValue(this.settings.type) || this.settings.type === 'proposal' || this.settings.type === 'summary') && !this.isDomainType()) {
      this.defaultSettings.tsort = 'oldest'
    } else {
      this.defaultSettings.tsort = 'newest'
    }
    if ((typeof this.settings.active) !== 'boolean') {
      this.settings.active = this.defaultSettings.active
    }
    if ((typeof this.settings.tavg) !== 'boolean') {
      this.settings.tavg = this.useMonthAvg
    }
    if (this.isNullValue(this.settings.ptype)) {
      this.settings.ptype = this.defaultSettings.ptype
    }
    if (this.isNullValue(this.settings.pgroup)) {
      this.settings.pgroup = this.defaultSettings.pgroup
    }
    if (!this.isNullValue(this.settings.type) && this.settings.type === 'treasury') {
      this.defaultSettings.stype = ''
    }

    if (this.settings.type === 'treasury' || this.isDomainType()) {
      this.settings.tsort = this.treasuryTSort
    } else {
      this.settings.tsort = this.proposalTSort
    }
    this.reportTypeTargets.forEach((rTypeTarget) => {
      rTypeTarget.classList.remove('active')
      if ((!this.settings.type && rTypeTarget.name === 'proposal') ||
        (rTypeTarget.name === 'proposal' && (this.settings.type === '' || this.settings.type === 'proposal' || this.settings.type === 'summary')) ||
        (rTypeTarget.name === 'treasury' && this.settings.type === 'treasury')) {
        rTypeTarget.classList.add('active')
      }
    })
    if (this.isNullValue(this.settings.interval)) {
      this.settings.interval = this.defaultSettings.interval
    }
    if (this.isNullValue(this.settings.ttype)) {
      this.settings.ttype = this.defaultSettings.ttype
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
    if (this.isTreasuryReport()) {
      this.ttypeTargets.forEach((ttypeTarget) => {
        ttypeTarget.classList.remove('active')
        if ((ttypeTarget.name === this.settings.ttype) || (ttypeTarget.name === 'current' && !this.settings.ttype)) {
          ttypeTarget.classList.add('active')
        }
      })
    }
    if (this.isNullValue(this.settings.type) || this.settings.type === 'proposal' || this.settings.type === 'summary') {
      this.proposalTypeTargets.forEach((proposalTypeTarget) => {
        proposalTypeTarget.classList.remove('active')
        if ((proposalTypeTarget.name === this.settings.pgroup) || (proposalTypeTarget.name === 'proposals' && !this.settings.pgroup)) {
          proposalTypeTarget.classList.add('active')
        }
      })
    }
  }

  async initScrollerForTable () {
    const $scroller = document.getElementById('scroller')
    const $container = document.getElementById('containerBody')
    const $wrapper = document.getElementById('wrapperReportTable')
    let ignoreScrollEvent = false
    let animation = null
    const scrollbarPositioner = () => {
      const scrollTop = document.scrollingElement.scrollTop
      const wrapperTop = $wrapper.offsetTop
      const wrapperBottom = wrapperTop + $wrapper.offsetHeight

      const topMatch = (window.innerHeight + scrollTop) >= wrapperTop
      const bottomMatch = (scrollTop) <= wrapperBottom

      if (topMatch && bottomMatch) {
        const inside = wrapperBottom >= scrollTop && window.innerHeight + scrollTop <= wrapperBottom

        if (inside) {
          $scroller.style.bottom = '0px'
        } else {
          const offset = (scrollTop + window.innerHeight) - wrapperBottom

          $scroller.style.bottom = offset + 'px'
        }
        $scroller.classList.add('visible')
      } else {
        $scroller.classList.remove('visible')
      }

      window.requestAnimationFrame(scrollbarPositioner)
    }

    window.requestAnimationFrame(scrollbarPositioner)

    $scroller.addEventListener('scroll', (e) => {
      if (ignoreScrollEvent) return false

      if (animation) window.cancelAnimationFrame(animation)
      animation = window.requestAnimationFrame(() => {
        ignoreScrollEvent = true
        $container.scrollLeft = $scroller.scrollLeft
        ignoreScrollEvent = false
      })
    })

    $container.addEventListener('scroll', (e) => {
      if (ignoreScrollEvent) return false

      if (animation) window.cancelAnimationFrame(animation)
      animation = window.requestAnimationFrame(() => {
        ignoreScrollEvent = true
        $scroller.scrollLeft = $container.scrollLeft

        ignoreScrollEvent = false
      })
    })

    $(window).on('resize', function () {
      // get table thead size
      const tableWidthStr = $('#reportTable thead').css('width').replace('px', '')
      const tableWidth = parseFloat(tableWidthStr.trim())
      const parentContainerWidthStr = $('#repotParentContainer').css('width').replace('px', '')
      const parentContainerWidth = parseFloat(parentContainerWidthStr.trim())
      if (tableWidth < parentContainerWidth + 5) {
        $('#scroller').addClass('d-none')
      } else {
        $('#scroller').removeClass('d-none')
      }
      // set overflow class
      $('#scroller').css('width', $('#repotParentContainer').css('width'))
    })
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
      if ((((typeof settings[k]) !== 'boolean') && !settings[k]) || settings[k].toString() === defaults[k].toString()) continue
      query[k] = settings[k]
    }
    this.query.replace(query)
  }

  parseSettingsState (isMain) {
    if (isMain) {
      mainReportSettingsState = {}
    } else {
      detailReportSettingsState = {}
    }
    for (const k in this.settings) {
      if (isMain) {
        mainReportSettingsState[k] = this.settings[k]
      } else {
        detailReportSettingsState[k] = this.settings[k]
      }
    }
  }

  parseSettingsFromState (isMain) {
    const state = isMain ? mainReportSettingsState : detailReportSettingsState
    if (!state) {
      for (const k in this.defaultSettings) {
        this.settings[k] = this.defaultSettings[k]
      }
      return
    }
    this.settings = {}
    for (const k in state) {
      this.settings[k] = state[k]
    }
  }

  setReportTitle () {
    switch (this.settings.type) {
      case '':
      case 'proposal':
        this.reportDescriptionTarget.innerHTML = proposalNote
        if (this.settings.pgroup === '' || this.settings.pgroup === 'proposals') {
          this.settings.interval = this.defaultSettings.interval
          this.reportDescriptionTarget.classList.add('d-none')
        } else if (this.settings.pgroup === 'authors') {
          if (this.settings.ptype !== 'list') {
            this.reportDescriptionTarget.classList.add('d-none')
          } else {
            this.reportDescriptionTarget.classList.remove('d-none')
            this.reportDescriptionTarget.innerHTML = proposalNote
          }
        }
        break
      case 'summary':
        this.reportDescriptionTarget.innerHTML = proposalNote
        break
      case 'domain':
        this.reportDescriptionTarget.innerHTML = proposalNote
        break
      case 'treasury':
        this.reportDescriptionTarget.innerHTML = treasuryNote
        break
      case 'author':
        this.reportDescriptionTarget.innerHTML = proposalNote
    }
  }

  async treasuryTypeChange (e) {
    if (e.target.name === this.settings.ttype) {
      return
    }
    const target = e.srcElement || e.target
    this.ttypeTargets.forEach((ttypeTarget) => {
      ttypeTarget.classList.remove('active')
    })
    target.classList.add('active')
    this.settings.ttype = e.target.name
    this.changedTType = e.target.name
    redrawChart = true
    await this.initData()
    await this.connectData()
  }

  async reportTypeChange (e) {
    if (((this.settings.type === '' || this.settings.type === 'proposal' || this.settings.type === 'summary') && e.target.name === 'proposal') ||
      (this.settings.type === 'treasury' && e.target.name === 'treasury') || (this.settings.type === 'bytime' && e.target.name === 'bytime')) {
      return
    }
    if (this.settings.type !== 'bytime' && e.target.name === 'bytime') {
      this.parseSettingsState(true)
      this.parseSettingsFromState(false)
    } else if (this.settings.type === 'bytime' && e.target.name !== 'bytime') {
      this.parseSettingsState(false)
      this.parseSettingsFromState(true)
    }
    this.settings.type = e.target.name
    if (this.settings.type === 'treasury') {
      this.settings.chart = this.treasuryChart
      this.optionsTarget.value = this.settings.chart
    } else if ((this.settings.type === '' || this.settings.type === 'proposal') && !this.isMonthDisplay && mainReportInitialized) {
      this.settings.type = 'summary'
    }
    if (this.settings.type === 'bytime') {
      this.initReportDetailData()
      return
    }
    redrawChart = true
    if (!mainReportInitialized) {
      await this.initMainFinancialReport()
    } else {
      await this.initData()
    }
    await this.connectData()
  }

  async proposalTypeChange (e) {
    if (e.target.name === this.settings.pgroup) {
      return
    }
    const target = e.srcElement || e.target
    this.proposalTypeTargets.forEach((proposalTypeTarget) => {
      proposalTypeTarget.classList.remove('active')
    })
    target.classList.add('active')
    this.settings.pgroup = e.target.name
    if (this.settings.pgroup === '' || this.settings.pgroup === 'proposals') {
      this.settings.type = this.isMonthDisplay ? 'proposal' : 'summary'
      this.settings.ptype = this.defaultSettings.ptype
    } else if (this.settings.pgroup === 'authors') {
      this.settings.ptype = this.isMonthDisplay ? '' : 'list'
      this.settings.type = this.defaultSettings.type
    } else if (this.settings.pgroup === 'domains') {
      this.settings.ptype = this.defaultSettings.ptype
    }
    this.settings.stype = this.defaultSettings.stype
    await this.initData()
    await this.connectData()
  }

  isProposalGroup () {
    return (this.settings.type === '' || this.settings.type === 'proposal' || this.settings.type === 'summary') && (this.settings.pgroup === '' || this.settings.pgroup === 'proposals')
  }

  isSummaryReport () {
    return this.settings.type === 'summary' && (this.settings.pgroup === '' || this.settings.pgroup === 'proposals')
  }

  isProposalMonthReport () {
    return (this.settings.type === '' || this.settings.type === 'proposal') && (this.settings.pgroup === '' || this.settings.pgroup === 'proposals')
  }

  isAuthorGroup () {
    return (this.settings.type === '' || this.settings.type === 'proposal' || this.settings.type === 'summary') && this.settings.pgroup === 'authors'
  }

  isAuthorListGroup () {
    return this.isAuthorGroup() && this.settings.ptype === 'list'
  }

  isAuthorMonthGroup () {
    return this.isAuthorGroup() && this.settings.ptype !== 'list'
  }

  isTreasuryReport () {
    return this.settings.type === 'treasury'
  }

  intervalChange (e) {
    if (e.target.name === ctrl.settings.interval) {
      return
    }
    const target = e.srcElement || e.target
    this.intervalTargets.forEach((intervalTarget) => {
      intervalTarget.classList.remove('active')
    })
    target.classList.add('active')
    ctrl.settings.interval = e.target.name
    // if (e.target.name === 'year') {
    //   if (ctrl.settings.bin !== 'year') {
    //     ctrl.binputs.forEach((button) => {
    //       if (button.name === 'year') {
    //         button.click()
    //       }
    //     })
    //     ctrl.zoomButtons.forEach((button) => {
    //       if (button.name === 'all') {
    //         button.click()
    //       }
    //     })
    //   }
    // } else {
    //   if (ctrl.settings.bin === 'year') {
    //     ctrl.binputs.forEach((button) => {
    //       if (button.name === 'month') {
    //         button.click()
    //       }
    //     })
    //     ctrl.zoomButtons.forEach((button) => {
    //       if (button.name === 'year') {
    //         button.click()
    //       }
    //     })
    //   }
    // }
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

  isNotChartZoom () {
    switch (this.settings.ttype) {
      case 'current':
        return !treasuryChartZoom
      case 'legacy':
        return !adminChartZoom
      default:
        return !combinedChartZoom
    }
  }

  createReportTable () {
    if (this.settings.type === '' || this.settings.type === 'proposal' || this.settings.type === 'summary') {
      $('#reportTable').css('width', '')
    }
    // if summary, display toggle for filter Proposals are active
    if (this.settings.type === 'summary') {
      if (!this.settings.active) {
        document.getElementById('activeProposalInput').checked = false
      } else {
        document.getElementById('activeProposalInput').checked = true
      }
    }
    this.updateQueryString()

    if (this.settings.type === 'treasury') {
      this.treasuryToggleAreaTarget.classList.remove('d-none')
      this.createTreasuryTable(responseData)
      this.treasuryChartTarget.classList.remove('d-none')
      const notChartZoom = this.isNotChartZoom()
      if (redrawChart) {
        this.initializeChart()
        this.drawGraph()
        redrawChart = false
        if (ctrl.zoomButtons && notChartZoom) {
          ctrl.zoomButtons.forEach((button) => {
            if (button.name === 'all') {
              button.click()
            }
          })
        }
      }
      this.selectTreasuryTypeTarget.classList.remove('d-none')
      this.currentBalanceAreaTarget.classList.remove('d-none')
      this.chartDataTarget.classList.remove('d-none')
      this.balanceOptionTarget.classList.remove('d-none')
      this.activeProposalSwitchAreaTarget.classList.add('d-none')
    } else {
      this.treasuryToggleAreaTarget.classList.add('d-none')
      this.currentBalanceAreaTarget.classList.add('d-none')
      this.selectTreasuryTypeTarget.classList.add('d-none')
      if (this.isSummaryReport() || this.isAuthorListGroup()) {
        this.activeProposalSwitchAreaTarget.classList.remove('d-none')
      } else {
        this.activeProposalSwitchAreaTarget.classList.add('d-none')
      }
      if (!this.isDomainType()) {
        this.outgoingExpTarget.classList.add('d-none')
        this.treasuryChartTarget.classList.add('d-none')
      } else {
        this.outgoingExpTarget.classList.remove('d-none')
        this.outgoingExpTarget.classList.add('mt-1')
        this.outgoingExpTarget.innerHTML = '*Delta (Est): Estimated difference between actual spending and estimated spending for Proposals. <br />&nbsp;<span style="font-style: italic;">(Delta > 0: Unaccounted, Delta < 0: Missing)</span>'
      }
    }

    if (this.isDomainType() || this.settings.type === 'treasury') {
      this.groupByTarget.classList.remove('d-none')
      this.useMonthAvgToggleTarget.classList.remove('d-none')
      this.treasuryChartTitleTarget.classList.remove('d-none')
      this.treasuryTypeTitleTarget.classList.remove('d-none')
      if (this.settings.type === 'treasury') {
        this.typeSelectorTarget.classList.remove('d-none')
        this.treasuryChartTitleTarget.textContent = 'Treasury IO Chart'
        this.weekGroupBtnTarget.classList.remove('d-none')
        this.dayGroupBtnTarget.classList.remove('d-none')
        // show some option on group and zoom
        this.weekZoomBtnTarget.classList.remove('d-none')
        this.dayZoomBtnTarget.classList.remove('d-none')
        // change domain on radio button label
        this.sentRadioLabelTarget.textContent = 'Sent'
        this.receivedRadioLabelTarget.textContent = 'Received'
        // hide net radio button
        this.netSelectRadioTarget.classList.remove('d-none')
      } else {
        this.typeSelectorTarget.classList.add('d-none')
        this.treasuryChartTitleTarget.textContent = 'Domains Chart Data'
        this.treasuryTypeTitleTarget.textContent = 'Domains Spending Data'
        this.weekGroupBtnTarget.classList.add('d-none')
        this.dayGroupBtnTarget.classList.add('d-none')
        // hide some option on group and zoom
        this.weekZoomBtnTarget.classList.add('d-none')
        this.dayZoomBtnTarget.classList.add('d-none')
        // change domain on radio button label
        this.sentRadioLabelTarget.textContent = 'Development'
        this.receivedRadioLabelTarget.textContent = 'Marketing'
        // hide net radio button
        this.netSelectRadioTarget.classList.add('d-none')
      }
    } else {
      this.groupByTarget.classList.add('d-none')
      this.useMonthAvgToggleTarget.classList.add('d-none')
      this.treasuryChartTitleTarget.classList.add('d-none')
      this.treasuryTypeTitleTarget.classList.add('d-none')
    }

    // if treasury, get table content in other area
    if (this.settings.type !== 'treasury') {
      this.reportTarget.innerHTML = this.createTableContent()
    }

    // handler for group domains and authors
    if (this.settings.type === '' || this.settings.type === 'proposal' || this.settings.type === 'summary') {
      if (this.settings.pgroup === 'domains') {
        this.treasuryChartTarget.classList.remove('d-none')
        // check chart type. If current is balance, change to amountflow
        if (this.settings.chart === 'balance' || this.chartType === 'balance') {
          this.settings.chart = 'amountflow'
          this.optionsTarget.value = 'amountflow'
        }
        const notChartZoom = !domainChartZoom
        if (redrawChart) {
          this.initializeChart()
          this.drawGraph()
          redrawChart = false
          // hide balance select option
          this.balanceOptionTarget.classList.add('d-none')
          this.chartDataTarget.classList.add('d-none')
          if (ctrl.zoomButtons && notChartZoom) {
            ctrl.zoomButtons.forEach((button) => {
              if (button.name === 'all') {
                button.click()
              }
            })
          }
        }
      }
    }
    const tableWidthStr = $('#reportTable thead').css('width').replace('px', '')
    const tableWidth = parseFloat(tableWidthStr.trim())
    const parentContainerWidthStr = $('#repotParentContainer').css('width').replace('px', '')
    const parentContainerWidth = parseFloat(parentContainerWidthStr.trim())
    let hideScroller = false
    if (tableWidth < parentContainerWidth + 5) {
      $('#scroller').addClass('d-none')
      hideScroller = true
    } else {
      $('#scroller').removeClass('d-none')
    }
    this.reportTarget.classList.add('proposal-table-padding')
    let widthFinal = $('#reportTable thead').css('width')
    if (widthFinal !== '' && !this.isProposalMonthReport() && !this.isAuthorMonthGroup()) {
      let width = parseFloat(widthFinal.replaceAll('px', ''))
      width += 30
      widthFinal = width + 'px'
      this.searchBoxTarget.classList.add('searchbox-align')
    } else {
      this.searchBoxTarget.classList.remove('searchbox-align')
    }
    $('#reportTable').css('width', this.isTreasuryReport() ? 'auto' : widthFinal)
    $('html').css('overflow-x', 'hidden')
    // set overflow class
    $('#containerReportTable').addClass('of-x-hidden')
    $('#containerBody').addClass('of-x-hidden')
    $('#scrollerLong').css('width', (tableWidth + 25) + 'px')
    // set scroller width fit with container width
    $('#scroller').css('width', $('#repotParentContainer').css('width'))
    if (this.isMobile()) {
      $('#containerBody').css('overflow', 'scroll')
      this.reportTarget.classList.remove('proposal-table-padding')
      $('#scroller').addClass('d-none')
    } else {
      this.reportTarget.classList.add('proposal-table-padding')
      if (!hideScroller) {
        $('#scroller').removeClass('d-none')
      }
    }
    if (this.isProposalMonthReport() || this.isAuthorMonthGroup()) {
      // handler for scroll default
      if (this.settings.psort === 'oldest') {
        if (this.settings.tsort === 'newest') {
          $('#scroller').scrollLeft(tableWidth)
        } else {
          $('#scroller').scrollLeft(0)
        }
      } else {
        if (this.settings.tsort === 'newest') {
          $('#scroller').scrollLeft(0)
        } else {
          $('#scroller').scrollLeft(tableWidth)
        }
      }
    }
    //  else {
    //   $('#scroller').addClass('d-none')
    // }
    // else {
    //   $('#reportTable').css('width', 'auto')
    //   $('#scroller').scrollLeft(0)
    //   $('#scroller').addClass('d-none')
    //   $('html').css('overflow-x', '')
    // }
  }

  createTableContent () {
    if ((this.settings.type === '' || this.settings.type === 'summary' || this.settings.type === 'proposal') &&
      this.settings.pgroup !== 'proposals' && this.settings.pgroup !== '') {
      if (this.settings.pgroup === 'domains') {
        return this.createDomainTable(responseData)
      }
      if (this.settings.pgroup === 'authors') {
        if (this.settings.ptype === 'list') {
          return this.createAuthorTable(responseData)
        } else {
          return this.createMonthAuthorTable(responseData)
        }
      }
      return ''
    }
    switch (this.settings.type) {
      case 'summary':
        return this.createSummaryTable(responseData)
      default:
        return this.createProposalTable(responseData)
    }
  }

  sortByCreateDate () {
    if (this.settings.type === 'treasury' || this.isDomainType()) {
      this.settings.tsort = this.settings.tsort === 'oldest' ? 'newest' : 'oldest'
      this.treasuryTSort = this.settings.tsort
    } else {
      this.settings.tsort = (this.settings.tsort === 'oldest' || !this.settings.tsort || this.settings.tsort === '') ? 'newest' : 'oldest'
      this.proposalTSort = this.settings.tsort
    }
    if (this.settings.type === 'treasury' || this.isDomainType()) {
      this.settings.stype = ''
    }
    this.createReportTable(false)
  }

  sortByDate () {
    this.settings.psort = (this.settings.psort === 'newest' || !this.settings.psort || this.settings.psort === '') ? 'oldest' : 'newest'
    this.createReportTable(false)
  }

  sortByStartDate () {
    this.sortByType('startdt')
  }

  sortByPName () {
    this.sortByType('pname')
  }

  sortByIncoming () {
    this.sortByType('incoming')
  }

  sortByRate () {
    this.sortByType('rate')
  }

  sortByOutgoing () {
    this.sortByType('outgoing')
  }

  sortByNet () {
    this.sortByType('net')
  }

  sortByBalance () {
    this.sortByType('balance')
  }

  sortSpentPercent () {
    this.sortByType('percent')
  }

  sortByOutgoingEst () {
    this.sortByType('outest')
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

  sortByDays () {
    this.sortByType('days')
  }

  sortByAvg () {
    this.sortByType('avg')
  }

  sortByDomainItem (e) {
    this.sortByType(e.params.domain)
  }

  sortByDomainTotal () {
    this.sortByType('total')
  }

  sortByUnaccounted () {
    this.sortByType('unaccounted')
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
    this.createReportTable(false)
  }

  getTreasuryYearlyData (summary) {
    const dataMap = new Map()
    const yearArr = []
    for (let i = 0; i < summary.length; i++) {
      const item = summary[i]
      const month = item.month
      if (month && month !== '') {
        const timeArr = month.split('-')
        const year = timeArr[0]
        if (!yearArr.includes(year)) {
          yearArr.push(year)
        }
        let monthStr = ''
        if (timeArr[1].charAt(0) === '0') {
          monthStr = timeArr[1].substring(1, timeArr[1].length)
        } else {
          monthStr = timeArr[1]
        }
        const monthInt = parseInt(monthStr, 0)
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
          monthObj.monthPrice += item.monthPrice
          monthObj.taddValue += item.taddValue
          monthObj.taddValueUSD += item.taddValueUSD
          monthObj.count += 1
          if (monthInt > monthObj.monthInt) {
            monthObj.monthInt = monthInt
            monthObj.creditLink = item.creditLink
            monthObj.debitLink = item.debitLink
            monthObj.balance = item.balance
            monthObj.balanceUSD = item.balanceUSD
          }
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
          monthObj.monthPrice = item.monthPrice
          monthObj.count = 1
          monthObj.monthInt = monthInt
          monthObj.balance = item.balance
          monthObj.balanceUSD = item.balanceUSD
          monthObj.debitLink = item.debitLink
          monthObj.creditLink = item.creditLink
          monthObj.taddValue = item.taddValue
          monthObj.taddValueUSD = item.taddValueUSD
        }
        dataMap.set(year, monthObj)
      }
    }
    const result = []
    yearArr.forEach((year) => {
      const tempResultItem = dataMap.get(year)
      if (tempResultItem.count > 0) {
        tempResultItem.monthPrice = tempResultItem.monthPrice / tempResultItem.count
      }
      result.push(tempResultItem)
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
            // calculate DCR value
            monthObj.domainData[i].expenseDCR += report.usdRate > 0 ? report.domainData[i].expense / report.usdRate : 0
          }
          monthObj.treasurySpent += report.treasurySpent
          monthObj.treasurySpentDCR += report.usdRate > 0 ? report.treasurySpent / report.usdRate : 0
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
            // calculate DCR value
            domainDataItem.expenseDCR = report.usdRate > 0 ? item.expense / report.usdRate : 0
            monthObj.domainData.push(domainDataItem)
          }
          monthObj.treasurySpent = report.treasurySpent
          monthObj.treasurySpentDCR = report.usdRate > 0 ? report.treasurySpent / report.usdRate : 0
        }
        dataMap.set(year, monthObj)
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
      '<div class="c1"><span data-action="click->financereport#sortByDate" class="homeicon-swap vertical-sort"></span></div><div class="c2"><span id="sortCreateDate" data-action="click->financereport#sortByCreateDate" class="homeicon-swap horizontal-sort"></span></div></th>' +
      '###' +
      '<th class="text-right ps-0 fw-600 fs-13i month-col ta-center border-left-grey report-last-header va-mid">Total</th>' +
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
        headList += `<a class="link-hover-underline fs-13i" data-turbolinks="false" style="text-align: right; width: 80px;" href="${'/finance-report/detail?type=' + this.settings.interval + '&time=' + (timeParam === '' ? report.month : timeParam)}">${report.month.replace('/', '-')}`
        headList += '</a></div></th>'
      } else {
        headList += '<th class="text-right fw-600 pb-30i fs-13i ps-2 pe-2 table-header-sticky va-mid" ' +
          `id="${this.settings.interval + ';' + report.month}" ` +
          `><a class="link-hover-underline fs-13i" data-turbolinks="false" href="${'/finance-report?type=bytime&dtype=month&dtime=' + (timeParam === '' ? report.month : timeParam)}"><span class="d-block pr-5">${report.month.replace('/', '-')}</span></a></th>`
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
      bodyList += `<tr class="odd-even-row"><td class="text-center fs-13i border-right-grey report-first-data"><a href="${'/finance-report/detail?type=proposal&token=' + token}" data-turbolinks="false" class="link-hover-underline fs-13i d-block ${this.settings.interval === 'year' ? 'proposal-year-title' : 'proposal-title-col'}">${proposal}</a></td>`
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
      bodyList += `<td class="text-right fs-13i fw-600 border-left-grey report-last-data va-mid">$${humanize.formatToLocalString(handlerData.summary[index].budget, 2, 2)}</td></tr>`
    }

    bodyList += '<tr class="finance-table-header finance-table-footer last-row-header">' +
      '<td class="text-center fw-600 fs-13i report-first-header report-first-last-footer va-mid">Total</td>'
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

    bodyList += `<td class="text-right fw-600 fs-13i report-last-header report-first-last-footer va-mid">$${humanize.formatToLocalString(handlerData.allSpent, 2, 2)}</td></tr>`

    tbody = tbody.replace('###', bodyList)
    return thead + tbody
  }

  createMonthAuthorTable (data) {
    if (!data.report) {
      return ''
    }

    const handlerData = data
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
    for (let i = 0; i < handlerData.report.length; i++) {
      const index = this.settings.tsort === 'newest' ? i : (handlerData.report.length - i - 1)
      const report = handlerData.report[index]
      const timeParam = this.getFullTimeParam(report.month, '/')

      if (this.settings.interval === 'year') {
        headList += `<th class="text-center fw-600 pb-30i fs-13i table-header-sticky va-mid" id="${this.settings.interval + ';' + report.month}">`
        headList += '<div class="d-flex justify-content-center">'
        headList += `<a class="link-hover-underline fs-13i" data-turbolinks="false" style="text-align: right; width: 80px;" href="${'/finance-report/detail?type=' + this.settings.interval + '&time=' + (timeParam === '' ? report.month : timeParam)}">${report.month.replace('/', '-')}`
        headList += '</a></div></th>'
      } else {
        headList += '<th class="text-right fw-600 pb-30i fs-13i ps-2 pe-2 table-header-sticky va-mid" ' +
          `id="${this.settings.interval + ';' + report.month}" ` +
          `><a class="link-hover-underline fs-13i" data-turbolinks="false" href="${'/finance-report?type=bytime&dtype=month&dtime=' + (timeParam === '' ? report.month : timeParam)}"><span class="d-block pr-5">${report.month.replace('/', '-')}</span></a></th>`
      }
    }
    thead = thead.replace('###', headList)

    let bodyList = ''
    for (let i = 0; i < handlerData.authorReport.length; i++) {
      const index = this.settings.psort === 'oldest' ? (handlerData.authorReport.length - i - 1) : i
      const author = handlerData.authorReport[index]
      const budget = author.budget
      bodyList += `<tr class="odd-even-row"><td class="text-center fs-13i border-right-grey report-first-data"><a data-turbolinks="false" href="/finance-report/detail?type=owner&name=${author.name}" class="link-hover-underline fw-600 fs-13i d-block ${this.settings.interval === 'year' ? 'proposal-year-title' : 'author-title-col'}">${author.name}</a></td>`
      for (let j = 0; j < handlerData.report.length; j++) {
        const tindex = this.settings.tsort === 'newest' ? j : (handlerData.report.length - j - 1)
        const report = handlerData.report[tindex]
        const expense = this.getAuthorExpense(author.name, report.authorData)
        if (expense > 0) {
          if (this.settings.interval === 'year') {
            bodyList += `<td class="${this.settings.interval === 'year' ? 'text-center' : 'text-right'} fs-13i proposal-content-td va-mid">`
            bodyList += '<div class="d-flex justify-content-center">'
            bodyList += `<span style="text-align: right; width: 80px;">$${humanize.formatToLocalString(expense, 2, 2)}</span>`
            bodyList += '</div>'
          } else {
            bodyList += '<td class="text-right fs-13i proposal-content-td va-mid">'
            bodyList += `$${humanize.formatToLocalString(expense, 2, 2)}`
          }
        } else {
          bodyList += '<td class="text-center fs-13i">'
        }
        bodyList += '</td>'
      }
      bodyList += `<td class="text-right fs-13i fw-600 border-left-grey report-last-data va-mid">$${humanize.formatToLocalString(budget, 2, 2)}</td></tr>`
    }

    bodyList += '<tr class="finance-table-header finance-table-footer last-row-header">' +
      '<td class="text-center fw-600 fs-13i report-first-header report-first-last-footer va-mid">Total</td>'
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

    bodyList += `<td class="text-right fw-600 fs-13i report-last-header report-first-last-footer va-mid">$${humanize.formatToLocalString(handlerData.allSpent, 2, 2)}</td></tr>`

    tbody = tbody.replace('###', bodyList)
    return thead + tbody
  }

  getAuthorExpense (author, authorData) {
    let expense = 0
    authorData.forEach(tmp => {
      if (tmp.author === author) {
        expense = tmp.expense
      }
    })
    return expense
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

    if (!this.settings.stype || this.settings.stype === '') {
      this.settings.stype = this.defaultSettings.stype
    }

    if (!this.settings.order || this.settings.order === '') {
      this.settings.order = this.defaultSettings.order
    }

    const thead = '<thead>' +
      '<tr class="text-secondary finance-table-header">' +
      '<th class="va-mid text-center fs-13i month-col fw-600 proposal-name-col">Name</th>' +
      '<th class="va-mid text-center fs-13i px-2 fw-600">Domain</th>' +
      '<th class="va-mid text-center fs-13i px-2 fw-600">Author</th>' +
      '<th class="va-mid text-center fs-13i px-2 fw-600"><label class="cursor-pointer" data-action="click->financereport#sortByStartDate">Start Date</label>' +
      `<span data-action="click->financereport#sortByStartDate" class="${(this.settings.stype === 'startdt' && this.settings.order === 'desc') ? 'dcricon-arrow-down' : 'dcricon-arrow-up'} ${(!this.settings.stype || this.settings.stype === '' || this.settings.stype === 'startdt') ? '' : 'c-grey-4'} col-sort ms-1"></span></th>` +
      '<th class="va-mid text-center fs-13i px-2 fw-600">End Date</th>' +
      '<th class="va-mid text-right fs-13i px-2 fw-600"><label class="cursor-pointer" data-action="click->financereport#sortByBudget">Budget</label>' +
      `<span data-action="click->financereport#sortByBudget" class="${(this.settings.stype === 'budget' && this.settings.order === 'desc') ? 'dcricon-arrow-down' : 'dcricon-arrow-up'} ${this.settings.stype !== 'budget' ? 'c-grey-4' : ''} col-sort ms-1"></span></th>` +
      '<th class="va-mid text-right fs-13i px-2 fw-600">Days</th>' +
      '<th class="va-mid text-right fs-13i px-2 fw-600">Monthly Avg (Est)</th>' +
      '<th class="va-mid text-right fs-13i px-2 fw-600">Total Spent (Est)</th>' +
      '<th class="va-mid text-right fs-13i px-2 fw-600">Total Remaining (Est)</th></tr></thead>'
    let tbody = '<tbody>###</tbody>'
    let bodyList = ''
    const proposalTokenMap = data.proposalTokenMap
    // Handler sort before display data
    // sort by param
    const summaryList = this.sortSummary(data.summary)
    let totalBudget = 0.0
    let totalSpent = 0.0
    // create tbody content
    for (let i = 0; i < summaryList.length; i++) {
      const summary = summaryList[i]
      if (this.settings.active && summary.totalRemaining === 0.0) {
        continue
      }
      let token = ''
      if (proposalTokenMap[summary.name] && proposalTokenMap[summary.name] !== '') {
        token = proposalTokenMap[summary.name]
      }
      const lengthInDays = this.getLengthInDay(summary)
      let monthlyAverage = summary.budget / lengthInDays
      if (lengthInDays < 30) {
        monthlyAverage = summary.budget
      } else {
        monthlyAverage = monthlyAverage * 30
      }
      totalBudget += summary.budget
      totalSpent += summary.totalSpent
      bodyList += `<tr class="${summary.totalRemaining === 0.0 ? 'proposal-summary-row' : 'summary-active-row'}">` +
        `<td class="va-mid text-center fs-13i proposal-name-column"><a href="${'/finance-report/detail?type=proposal&token=' + token}" data-turbolinks="false" class="link-hover-underline fs-13i">${summary.name}</a></td>` +
        `<td class="va-mid text-center px-2 fs-13i"><a href="${'/finance-report/detail?type=domain&name=' + summary.domain}" data-turbolinks="false" class="link-hover-underline fs-13i">${summary.domain.charAt(0).toUpperCase() + summary.domain.slice(1)}</a></td>` +
        `<td class="va-mid text-center px-2 fs-13i"><a href="${'/finance-report/detail?type=owner&name=' + summary.author}" data-turbolinks="false" class="link-hover-underline fs-13i">${summary.author}</a></td>` +
        `<td class="va-mid text-center px-2 fs-13i">${summary.start}</td>` +
        `<td class="va-mid text-center px-2 fs-13i">${summary.end}</td>` +
        `<td class="va-mid text-right px-2 fs-13i">$${humanize.formatToLocalString(summary.budget, 2, 2)}</td>` +
        `<td class="va-mid text-right px-2 fs-13i">${lengthInDays}</td>` +
        `<td class="va-mid text-right px-2 fs-13i">$${humanize.formatToLocalString(monthlyAverage, 2, 2)}</td>` +
        `<td class="va-mid text-right px-2 fs-13i">${summary.totalSpent > 0 ? '$' + humanize.formatToLocalString(summary.totalSpent, 2, 2) : '-'}</td>` +
        `<td class="va-mid text-right px-2 fs-13i">${summary.totalRemaining > 0 ? '$' + humanize.formatToLocalString(summary.totalRemaining, 2, 2) : '-'}</td>` +
        '</tr>'
    }

    bodyList += '<tr class="finance-table-header finance-table-footer last-row-header">' +
      '<td class="va-mid text-center fw-600 fs-13i" colspan="5">Total</td>' +
      `<td class="va-mid text-right px-2 fw-600 fs-13i">$${humanize.formatToLocalString(totalBudget, 2, 2)}</td>` +
      '<td class="va-mid text-right px-2 fw-600 fs-13i">-</td><td class="va-mid text-right px-2 fw-600 fs-13i">-</td>' +
      `<td class="va-mid text-right px-2 fw-600 fs-13i">$${humanize.formatToLocalString(totalSpent, 2, 2)}</td>` +
      `<td class="va-mid text-right px-2 fw-600 fs-13i">$${humanize.formatToLocalString(totalBudget - totalSpent, 2, 2)}</td>` +
      '</tr>'

    tbody = tbody.replace('###', bodyList)
    return thead + tbody
  }

  changeYear (e) {
    if (!e.target.value || e.target.value === '') {
      return
    }
    this.settings.year = e.target.value
    this.calculate()
  }

  changeTopYear (e) {
    if (!e.target.value || e.target.value === '') {
      return
    }
    const currentTime = this.settings.dtime
    const timeArr = currentTime.toString().split('_')
    let currentMonth = 0
    if (timeArr.length > 1) {
      currentMonth = Number(timeArr[1])
    }
    if ((e.target.value === this.reportMinYear && currentMonth < this.reportMinMonth) || (e.target.value === this.reportMaxYear && currentMonth > this.reportMaxMonth)) {
      currentMonth = 0
    }
    this.settings.dtime = e.target.value + (currentMonth > 0 ? '_' + currentMonth : '')
    this.initReportDetailData()
  }

  changeTopMonth (e) {
    if (!e.target.value || e.target.value === '') {
      return
    }
    const currentTime = this.settings.dtime
    const timeArr = currentTime.toString().split('_')
    const year = timeArr[0]
    if (e.target.value > 0) {
      this.settings.dtime = year + '_' + e.target.value
    } else {
      this.settings.dtime = year
    }
    this.initReportDetailData()
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

  sortDomains (domainDataList) {
    let result = []
    if (!domainDataList || domainDataList.length === 0) {
      return result
    }

    // if not sort by data column, sort by month, year
    if (!this.settings.stype || this.settings.stype === '') {
      for (let i = 0; i < domainDataList.length; i++) {
        const sort = this.settings.tsort
        result.push(sort === 'oldest' ? domainDataList[domainDataList.length - i - 1] : domainDataList[i])
      }
      return result
    }

    result = Array.from(domainDataList)
    const _this = this
    result.sort(function (a, b) {
      let aData = null
      let bData = null
      if (_this.settings.stype === 'total') {
        aData = a.total + (a.unaccounted > 0 ? a.unaccounted : 0)
        bData = b.total + (b.unaccounted > 0 ? b.unaccounted : 0)
      } else if (_this.settings.stype === 'unaccounted') {
        aData = a.unaccounted
        bData = b.unaccounted
      } else if (_this.settings.stype === 'rate') {
        aData = a.usdRate
        bData = b.usdRate
      } else {
        a.domainData.forEach((aDomainData) => {
          if (_this.settings.stype === aDomainData.domain) {
            aData = aDomainData.expense
          }
        })
        b.domainData.forEach((bDomainData) => {
          if (_this.settings.stype === bDomainData.domain) {
            bData = bDomainData.expense
          }
        })
      }
      if (aData > bData) {
        return _this.settings.order === 'desc' ? -1 : 1
      }
      if (aData < bData) {
        return _this.settings.order === 'desc' ? 1 : -1
      }
      return 0
    })

    return result
  }

  sortTreasury (treasuryList) {
    let result = []
    if (!treasuryList) {
      return result
    }
    // if not sort by data column, sort by month, year
    if (!this.settings.stype || this.settings.stype === '') {
      for (let i = 0; i < treasuryList.length; i++) {
        const sort = this.settings.tsort
        result.push(sort === 'newest' ? treasuryList[i] : treasuryList[treasuryList.length - i - 1])
      }
      return result
    }

    result = Array.from(treasuryList)
    const _this = this
    result.sort(function (a, b) {
      let aData = null
      let bData = null
      switch (_this.settings.stype) {
        case 'outgoing':
          aData = a.outvalue
          bData = b.outvalue
          break
        case 'net':
          aData = a.outvalue > a.invalue ? 0 - a.difference : a.difference
          bData = b.outvalue > b.invalue ? 0 - b.difference : b.difference
          break
        case 'outest':
          aData = a.outEstimate
          bData = b.outEstimate
          break
        case 'rate':
          aData = a.monthPrice
          bData = b.monthPrice
          break
        case 'balance':
          aData = a.balance
          bData = b.balance
          break
        case 'percent':
          aData = 0
          bData = 0
          if (a.outvalue > 0) {
            aData = 100 * 1e8 * a.outEstimate / a.outvalue
          }
          if (b.outvalue > 0) {
            bData = 100 * 1e8 * b.outEstimate / b.outvalue
          }
          break
        default:
          aData = a.invalue
          bData = b.invalue
      }
      if (aData > bData) {
        return _this.settings.order === 'desc' ? -1 : 1
      }
      if (aData < bData) {
        return _this.settings.order === 'desc' ? 1 : -1
      }
      return 0
    })

    return result
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
      case 'days':
        return this.sortSummaryByDays(summary)
      case 'avg':
        return this.sortSummaryByAvg(summary)
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

  sortSummaryByDays (summary) {
    if (!summary) {
      return
    }
    const _this = this
    summary.sort(function (a, b) {
      const lengtha = _this.getLengthInDay(a)
      const lengthb = _this.getLengthInDay(b)
      if (lengtha > lengthb) {
        return _this.settings.order === 'desc' ? -1 : 1
      }
      if (lengtha < lengthb) {
        return _this.settings.order === 'desc' ? 1 : -1
      }
      return 0
    })

    return summary
  }

  sortSummaryByAvg (summary) {
    if (!summary) {
      return
    }
    const _this = this
    summary.sort(function (a, b) {
      const avga = (a.budget / _this.getLengthInDay(a)) * 30
      const avgb = (b.budget / _this.getLengthInDay(b)) * 30
      if (avga > avgb) {
        return _this.settings.order === 'desc' ? -1 : 1
      }
      if (avga < avgb) {
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

    if (!this.settings.stype || this.settings.stype === '') {
      this.settings.stype = 'author'
    }

    if (!this.settings.order || this.settings.order === '') {
      this.settings.order = this.defaultSettings.order
    }

    const thead = '<thead>' +
      '<tr class="text-secondary finance-table-header">' +
      '<th class="va-mid text-center px-2 fs-13i month-col fw-600"><label class="cursor-pointer" data-action="click->financereport#sortByAuthor">Author</label>' +
      `<span data-action="click->financereport#sortByAuthor" class="${(this.settings.stype === 'author' && this.settings.order === 'desc') ? 'dcricon-arrow-down' : 'dcricon-arrow-up'} ${this.settings.stype !== 'author' ? 'c-grey-4' : ''} col-sort ms-1"></span></th>` +
      '<th class="va-mid text-center px-2 fs-13i fw-600"><label class="cursor-pointer" data-action="click->financereport#sortByPNum">Proposals</label>' +
      `<span data-action="click->financereport#sortByPNum" class="${(this.settings.stype === 'pnum' && this.settings.order === 'desc') ? 'dcricon-arrow-down' : 'dcricon-arrow-up'} ${this.settings.stype !== 'pnum' ? 'c-grey-4' : ''} col-sort ms-1"></span></th>` +
      '<th class="va-mid text-right px-2 fs-13i fw-600"><label class="cursor-pointer" data-action="click->financereport#sortByBudget">Total Budget</label>' +
      `<span data-action="click->financereport#sortByBudget" class="${(this.settings.stype === 'budget' && this.settings.order === 'desc') ? 'dcricon-arrow-down' : 'dcricon-arrow-up'} ${this.settings.stype !== 'budget' ? 'c-grey-4' : ''} col-sort ms-1"></span></th>` +
      '<th class="va-mid text-right px-2 fs-13i fw-600">Total Received (Est)</th>' +
      '<th class="va-mid text-right px-2 fs-13i fw-600">Total Remaining (Est)</th>' +
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
      if (this.settings.active && author.totalRemaining === 0.0) {
        continue
      }
      totalBudget += author.budget
      totalSpent += author.totalReceived
      totalRemaining += author.totalRemaining
      totalProposals += author.proposals
      bodyList += `<tr class="${author.totalRemaining === 0.0 ? 'proposal-summary-row' : 'summary-active-row'}"><td class="va-mid text-center px-2 fs-13i fw-600"><a class="link-hover-underline fs-13i" data-turbolinks="false" href="${'/finance-report/detail?type=owner&name=' + author.name}">${author.name}</a></td>`
      bodyList += `<td class="va-mid text-center px-2 fs-13i">${author.proposals}</td>`
      bodyList += `<td class="va-mid text-right px-2 fs-13i">${author.budget > 0 ? '$' + humanize.formatToLocalString(author.budget, 2, 2) : '-'}</td>`
      bodyList += `<td class="va-mid text-right px-2 fs-13i">${author.totalReceived > 0 ? '$' + humanize.formatToLocalString(author.totalReceived, 2, 2) : '-'}</td>`
      bodyList += `<td class="va-mid text-right px-2 fs-13i">${author.totalRemaining > 0 ? '$' + humanize.formatToLocalString(author.totalRemaining, 2, 2) : '-'}</td></tr>`
    }

    bodyList += '<tr class="finance-table-header finance-table-footer last-row-header">' +
      '<td class="va-mid text-center px-2 fw-600 fs-13i">Total</td>' +
      `<td class="va-mid text-center px-2 fw-600 fs-13i">${totalProposals}</td>` +
      `<td class="va-mid text-right px-2 fw-600 fs-13i">$${humanize.formatToLocalString(totalBudget, 2, 2)}</td>` +
      `<td class="va-mid text-right px-2 fw-600 fs-13i">$${humanize.formatToLocalString(totalSpent, 2, 2)}</td>` +
      `<td class="va-mid text-right px-2 fw-600 fs-13i">$${humanize.formatToLocalString(totalRemaining, 2, 2)}</td>` +
      '</tr>'
    tbody = tbody.replace('###', bodyList)
    return thead + tbody
  }

  createDomainTable (data) {
    if (!data.report) {
      return ''
    }
    let handlerData = data
    // combined data of report and treasury report
    const treasuryDataMap = this.getTreasuryMonthSpentMap(data.treasurySummary)
    handlerData = this.getTreasuryDomainCombined(handlerData, treasuryDataMap)
    if (this.settings.interval === 'year') {
      handlerData = domainYearData != null ? domainYearData : this.getProposalYearlyData(handlerData)
      this.futureLabelTarget.textContent = 'Years in the future'
    } else {
      this.futureLabelTarget.textContent = 'Months in the future'
    }

    if (handlerData.report.length < 1) {
      this.nodataTarget.classList.remove('d-none')
      this.reportTarget.classList.add('d-none')
      return
    }
    this.nodataTarget.classList.add('d-none')
    this.reportTarget.classList.remove('d-none')
    let thead = '<col><colgroup span="2"></colgroup><col5group span="5"></col5group><thead><tr class="text-secondary finance-table-header">' +
      `<th rowspan="2" class="va-mid text-center ps-0 month-col cursor-pointer" data-action="click->financereport#sortByCreateDate"><span class="${this.settings.tsort === 'oldest' ? 'dcricon-arrow-up' : 'dcricon-arrow-down'} ${this.settings.stype && this.settings.stype !== '' ? 'c-grey-4' : ''} col-sort"></span></th>`
    if (this.settings.interval !== 'year') {
      thead += '<th rowspan="2" class="va-mid text-right-i fs-13i px-2 fw-600 treasury-content-cell">Rate (USD/DCR)</th>'
    }
    thead += '###' +
      '<th colspan="2" scope="colgroup" class="va-mid text-center-i fs-13i fw-600">Delta (Est)</th>' +
      '<th colspan="5" scope="col5group" class="va-mid text-center-i total-last-col fs-13i fw-600 border-left-grey">Total Spent</th></tr>####</thead>'
    let row2 = '<tr class="text-secondary finance-table-header">'
    let tbody = '<tbody>###</tbody>'

    let headList = ''
    let domainsRateColumn = ''
    handlerData.domainList.forEach((domain) => {
      const domainDisp = domain.charAt(0).toUpperCase() + domain.slice(1)
      headList += `<th colspan="2" scope="colgroup" class="va-mid text-center-i domain-content-cell fs-13i fw-600"><a href="${'/finance-report/detail?type=domain&name=' + domain}" data-turbolinks="false" class="link-hover-underline fs-13i">${domainDisp} (Est)</a>` +
        `<span data-action="click->financereport#sortByDomainItem" data-financereport-domain-param="${domain}" class="${(this.settings.stype === domain && this.settings.order === 'desc') ? 'dcricon-arrow-down' : 'dcricon-arrow-up'} ${this.settings.stype !== domain ? 'c-grey-4' : ''} col-sort ms-1"></span></th>`
      row2 += '<th scope="col" class="va-mid text-center-i fs-13i fw-600">USD</th>' +
        '<th scope="col" class="va-mid text-center-i fs-13i fw-600">DCR</th>'
      domainsRateColumn += `<th scope="col" class="va-mid text-center-i fs-13i fw-600">${domainDisp}</th>`
    })
    headList += '<th colspan="2" scope="colgroup" class="va-mid text-center-i fs-13i fw-600">Dev Spend Total (Est)</th>'
    row2 += '<th scope="col" class="va-mid text-center-i fs-13i fw-600">USD</th>' +
      '<th scope="col" class="va-mid text-center-i fs-13i fw-600">DCR</th>' +
      '<th scope="col" class="va-mid text-center-i fs-13i fw-600">USD</th>' +
      '<th scope="col" class="va-mid text-center-i fs-13i fw-600">DCR</th>' +
      '<th scope="col" class="va-mid text-center-i fs-13i fw-600">USD</th>' +
      '<th scope="col" class="va-mid text-center-i fs-13i fw-600">DCR</th>' +
      domainsRateColumn +
      '<th scope="col" class="va-mid text-center-i fs-13i fw-600">Unaccounted</th></tr>'
    thead = thead.replace('####', row2)
    thead = thead.replace('###', headList)
    let bodyList = ''
    const domainDataMap = new Map()
    // sort before display on table
    const domainList = this.sortDomains(handlerData.report)
    let unaccountedTotal = 0
    let unaccountedDcrTotal = 0
    let totalAllDcr = 0
    let totalAllValue = 0
    let totalDevAll = 0
    let totalDevAllDCR = 0
    const domainDCRTotalMap = new Map()
    const _this = this
    // create tbody content
    for (let i = 0; i < domainList.length; i++) {
      const report = domainList[i]
      const timeParam = this.getFullTimeParam(report.month, '/')
      let isFuture = false
      const timeYearMonth = this.getYearMonthArray(report.month, '/')
      const nowDate = new Date()
      const year = nowDate.getUTCFullYear()
      const month = nowDate.getUTCMonth() + 1
      let rowTotal = 0
      let rowTotalDCR = 0
      if (this.settings.interval === 'year') {
        isFuture = timeYearMonth[0] > year
      } else {
        const compareDataTime = timeYearMonth[0] * 12 + timeYearMonth[1]
        const compareNowTime = year * 12 + month
        isFuture = compareDataTime > compareNowTime
      }
      const usdRate = this.settings.interval === 'year' ? 0 : report.usdRate
      bodyList += `<tr class="odd-even-row ${isFuture ? 'future-row-data' : ''}"><td class="va-mid text-center fs-13i fw-600"><a class="link-hover-underline fs-13i" data-turbolinks="false" style="text-align: right; width: 80px;" href="${'/finance-report?type=bytime&' + (this.settings.interval === 'year' ? '' : 'dtype=month&') + 'dtime=' + (timeParam === '' ? report.month : timeParam)}">${report.month.replace('/', '-')}</a></td>`
      if (this.settings.interval !== 'year') {
        bodyList += `<td class="va-mid text-right px-2 fs-13i">${usdRate > 0 ? '$' + humanize.formatToLocalString(usdRate, 2, 2) : '-'}</td>`
      }
      report.domainData.forEach((domainData) => {
        const dcrValue = this.settings.interval === 'year' ? domainData.expenseDCR : (usdRate > 0 ? domainData.expense / usdRate : 0)
        const dcrDisp = dcrValue > 0 ? humanize.formatToLocalString(dcrValue, 2, 2) : '-'
        bodyList += `<td class="va-mid text-right px-2 fs-13i">${domainData.expense > 0 ? '$' + humanize.formatToLocalString(domainData.expense, 2, 2) : '-'}</td>` +
          `<td class="va-mid text-right px-2 fs-13i">${dcrDisp}</td>`
        rowTotal += domainData.expense > 0 ? domainData.expense : 0
        rowTotalDCR += dcrValue > 0 ? dcrValue : 0
        if (domainDataMap.has(domainData.domain)) {
          domainDataMap.set(domainData.domain, domainDataMap.get(domainData.domain) + domainData.expense)
        } else {
          domainDataMap.set(domainData.domain, domainData.expense)
        }
        if (domainDCRTotalMap.has(domainData.domain)) {
          domainDCRTotalMap.set(domainData.domain, domainDCRTotalMap.get(domainData.domain) + dcrValue)
        } else {
          domainDCRTotalMap.set(domainData.domain, dcrValue)
        }
      })
      const devTotal = rowTotal
      const devTotalDCR = rowTotalDCR
      totalDevAll += devTotal
      totalDevAllDCR += devTotalDCR
      const unaccounted = report.treasurySpent > 0 ? report.treasurySpent - devTotal : -devTotal
      const unaccountedDcr = this.settings.interval === 'year' ? (report.treasurySpentDCR > 0 ? report.treasurySpentDCR - rowTotalDCR : -rowTotalDCR) : (usdRate > 0 ? unaccounted / usdRate : 0)
      const unaccountedDcrDisp = (unaccountedDcr >= 0 ? '' : '-') + humanize.formatToLocalString(Math.abs(unaccountedDcr), 2, 2)
      rowTotal += unaccounted
      rowTotalDCR += unaccountedDcr
      let rateStr = ''
      let unaccountedPercent = 100
      report.domainData.forEach((domainData) => {
        const rate = _this.isZeroNumber(rowTotal) ? 0 : 100 * domainData.expense / rowTotal
        rateStr += `<td class="va-mid text-right fs-13i px-2 fw-600">${isFuture || rowTotal <= 0 ? '-' : ((rate < 0 ? '-' : '') + humanize.formatToLocalString(Math.abs(rate), 2, 2) + '%')}</td>`
        unaccountedPercent -= rate
      })
      rateStr += `<td class="va-mid text-right fs-13i px-2 fw-600">${isFuture || rowTotal <= 0 ? '-' : ((unaccountedPercent < 0 ? '-' : '') + humanize.formatToLocalString(Math.abs(unaccountedPercent), 2, 2) + '%')}</td>`
      const totalDcrDisp = this.isZeroNumber(rowTotalDCR) ? '-' : (rowTotalDCR < 0 ? '-' : '') + humanize.formatToLocalString(Math.abs(rowTotalDCR), 2, 2)
      totalAllDcr += rowTotalDCR > 0 ? rowTotalDCR : 0
      totalAllValue += rowTotal > 0 ? rowTotal : 0
      unaccountedTotal += unaccounted
      unaccountedDcrTotal += unaccountedDcr
      // display dev spent total
      bodyList += `<td class="va-mid text-right fs-13i px-2">${devTotal > 0 ? '$' + humanize.formatToLocalString(devTotal, 2, 2) : '-'}</td>` +
      `<td class="va-mid text-right fs-13i px-2">${devTotalDCR > 0 ? humanize.formatToLocalString(devTotalDCR, 2, 2) : '-'}</td>` +
      `<td class="va-mid text-right px-2 fs-13i">${isFuture ? '-' : (unaccounted >= 0 ? '' : '-') + '$' + humanize.formatToLocalString(Math.abs(unaccounted), 2, 2)}`
      if (!isFuture) {
        bodyList += `<span class="dcricon-info cursor-pointer cell-tooltip ms-1" data-action="click->financereport#showUnaccountedUSDTooltip" data-show="${report.treasurySpent + ';' + devTotal}"><span class="tooltiptext cursor-default click-popup"><span class="tooltip-text d-flex ai-center"></span></span></span>`
      }
      bodyList += '</td>' +
        `<td class="va-mid text-right fs-13i px-2">${isFuture ? '-' : unaccountedDcrDisp}</td>` +
        `<td class="va-mid text-right fs-13i px-2 fw-600">${this.isZeroNumber(rowTotal) ? '-' : (rowTotal < 0 ? '-' : '') + '$' + humanize.formatToLocalString(Math.abs(rowTotal), 2, 2)}</td>` +
        `<td class="va-mid text-right fs-13i px-2 fw-600">${totalDcrDisp}</td>` +
        `${rateStr}</tr>`
    }

    bodyList += '<tr class="finance-table-header finance-table-footer last-row-header"><td class="text-center fw-600 fs-13i border-right-grey">Total (Est)</td>'
    if (this.settings.interval !== 'year') {
      bodyList += '<td class="va-mid text-right fw-600 fs-13i px-2">-</td>'
    }
    let rateTotalStr = ''
    let unaccountedTotalPercent = 100
    handlerData.domainList.forEach((domain) => {
      const expData = domainDataMap.has(domain) ? domainDataMap.get(domain) : 0
      const expDcrData = domainDCRTotalMap.has(domain) ? domainDCRTotalMap.get(domain) : 0
      const rateTotal = _this.isZeroNumber(totalAllValue) ? 0 : 100 * expData / totalAllValue
      bodyList += `<td class="va-mid text-right fw-600 fs-13i px-2">$${humanize.formatToLocalString(expData, 2, 2)}</td>`
      bodyList += `<td class="va-mid text-right fw-600 fs-13i px-2">${humanize.formatToLocalString(expDcrData, 2, 2)}</td>`
      rateTotalStr += `<td class="va-mid text-right fw-600 fs-13i px-2">${(rateTotal < 0 ? '-' : '') + humanize.formatToLocalString(Math.abs(rateTotal), 2, 2) + '%'}</td>`
      unaccountedTotalPercent -= rateTotal
    })
    rateTotalStr += `<td class="va-mid text-right fw-600 fs-13i px-2">${(unaccountedTotalPercent < 0 ? '-' : '') + humanize.formatToLocalString(Math.abs(unaccountedTotalPercent), 2, 2) + '%'}</td>`
    bodyList += `<td class="va-mid text-right fw-600 fs-13i px-2">$${humanize.formatToLocalString(totalDevAll, 2, 2)}</td>` +
      `<td class="va-mid text-right fw-600 fs-13i px-2">$${humanize.formatToLocalString(totalDevAllDCR, 2, 2)}</td>` +
     `<td class="va-mid text-right fw-600 fs-13i px-2">${this.isZeroNumber(unaccountedTotal) ? '-' : (unaccountedTotal < 0 ? '-' : '') + '$' + humanize.formatToLocalString(Math.abs(unaccountedTotal), 2, 2)}</td>` +
      `<td class="va-mid text-right fw-600 fs-13i px-2">${this.isZeroNumber(unaccountedDcrTotal) ? '-' : (unaccountedDcrTotal < 0 ? '-' : '') + humanize.formatToLocalString(Math.abs(unaccountedDcrTotal), 2, 2)}</td>` +
      `<td class="va-mid text-right fw-600 fs-13i px-2">$${humanize.formatToLocalString(totalAllValue, 2, 2)}</td>` +
      `<td class="va-mid text-right fw-600 fs-13i px-2">${totalAllDcr > 0 ? humanize.formatToLocalString(totalAllDcr, 2, 2) : '-'}</td>` +
      `${rateTotalStr}</tr>`

    tbody = tbody.replace('###', bodyList)
    return thead + tbody
  }

  isZeroNumber (number) {
    if (number === 0) {
      return true
    }
    const num = Math.abs(number)
    return num.toFixed(2) === '0.00'
  }

  showIngoingTaddTooltip (e) {
    const target = e.target
    const data = target.dataset.show
    if (!data || data === '') {
      return
    }
    const dataArr = data.split(';')
    if (dataArr.length < 2) {
      return
    }
    const tooltipText = target.getElementsByClassName('tooltiptext')[0]
    if (!tooltipText) {
      return
    }
    if (target.classList.contains('active')) {
      target.classList.remove('active')
      tooltipText.style.visibility = 'hidden'
    } else {
      target.classList.add('active')
      tooltipText.style.visibility = 'visible'
      const textElement = tooltipText.getElementsByClassName('tooltip-text')[0]
      if (!textElement) {
        return
      }
      textElement.innerHTML = `<p>Decentralized Treasury received <br /><span class="fw-600">${humanize.formatToLocalString(Number(dataArr[0]), 2, 2)} DCR(~$${humanize.formatToLocalString(Number(dataArr[1]), 2, 2)})</span> <br />from Admin Treasury</p>`
    }
  }

  showOutgoingTaddTooltip (e) {
    const target = e.target
    const data = target.dataset.show
    if (!data || data === '') {
      return
    }
    const dataArr = data.split(';')
    if (dataArr.length < 2) {
      return
    }
    const tooltipText = target.getElementsByClassName('tooltiptext')[0]
    if (!tooltipText) {
      return
    }
    if (target.classList.contains('active')) {
      target.classList.remove('active')
      tooltipText.style.visibility = 'hidden'
    } else {
      target.classList.add('active')
      tooltipText.style.visibility = 'visible'
      const textElement = tooltipText.getElementsByClassName('tooltip-text')[0]
      if (!textElement) {
        return
      }
      textElement.innerHTML = `<p>Admin Treasury sent <br /><span class="fw-600">${humanize.formatToLocalString(Number(dataArr[0]), 2, 2)} DCR(~$${humanize.formatToLocalString(Number(dataArr[1]), 2, 2)})</span><br />to Decentralized Treasury</p>`
    }
  }

  showUnaccountedUSDTooltip (e) {
    const target = e.target
    const data = target.dataset.show
    if (!data || data === '') {
      return
    }
    const dataArr = data.split(';')
    if (dataArr.length < 2) {
      return
    }
    const tooltipText = target.getElementsByClassName('tooltiptext')[0]
    if (!tooltipText) {
      return
    }
    if (target.classList.contains('active')) {
      target.classList.remove('active')
      tooltipText.style.visibility = 'hidden'
    } else {
      target.classList.add('active')
      tooltipText.style.visibility = 'visible'
      const textElement = tooltipText.getElementsByClassName('tooltip-text')[0]
      if (!textElement) {
        return
      }
      textElement.innerHTML = `<div class="fs-18">-</div><div class="ms-2"><p>Treasury Spent: <span class="fw-600">$${humanize.formatToLocalString(Number(dataArr[0].trim()), 2, 2)}</span></p><p class="mt-2">Estimate Spend: <span class="fw-600">$${humanize.formatToLocalString(Number(dataArr[1].trim()), 2, 2)}</span></p></div>`
    }
  }

  showUnaccountedTooltip (e) {
    const target = e.target
    const data = target.dataset.show
    if (!data || data === '') {
      return
    }
    const dataArr = data.split(';')
    if (dataArr.length < 2) {
      return
    }
    const tooltipText = target.getElementsByClassName('tooltiptext')[0]
    if (!tooltipText) {
      return
    }
    if (target.classList.contains('active')) {
      target.classList.remove('active')
      tooltipText.style.visibility = 'hidden'
    } else {
      target.classList.add('active')
      tooltipText.style.visibility = 'visible'
      const textElement = tooltipText.getElementsByClassName('tooltip-text')[0]
      if (!textElement) {
        return
      }
      textElement.innerHTML = `<div class="fs-18">-</div><div class="ms-2"><p>Treasury Spent: <span class="fw-600">${humanize.formatToLocalString(Number(dataArr[0].trim()), 2, 2)} DCR</span></p><p class="mt-2">Dev Spent (Est): <span class="fw-600">${humanize.formatToLocalString(Number(dataArr[1].trim()), 2, 2)} DCR</span></p></div>`
    }
  }

  getTreasuryDomainCombined (reportData, treasuryDataMap) {
    const report = reportData.report
    if (!report || report.length === 0) {
      return reportData
    }
    for (let i = report.length - 1; i >= 0; i--) {
      const reportItem = report[i]
      const monthFormat = reportItem.month.replace('/', '-')
      reportData.report[i].treasurySpent = treasuryDataMap.has(monthFormat) ? treasuryDataMap.get(monthFormat) : 0
    }
    return reportData
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

  getYearMonthArray (timeInput, splitChar) {
    const timeArr = timeInput.split(splitChar)
    const result = []
    if (timeArr.length < 2) {
      result.push(parseInt(timeArr[0]))
      return result
    }
    result.push(parseInt(timeArr[0]))
    result.push(parseInt(timeArr[1]))
    return result
  }

  createTreasuryTable (data) {
    this.treasuryTypeTitleTarget.textContent = this.settings.ttype === 'legacy' ? 'Admin Treasury' : this.settings.ttype === 'combined' ? 'Combined' : 'Decentralized Treasury'
    if (this.isCombinedReport()) {
      this.outgoingExpTarget.classList.remove('d-none')
      this.outgoingExpTarget.classList.remove('mt-2')
      this.outgoingExpTarget.innerHTML = '*Dev Spent (Est): Estimated costs covered for proposals.<br />' +
      '*Delta (Est): Estimated difference between actual spending and estimated spending for Proposals. <br />&nbsp;<span style="font-style: italic;">(Delta > 0: Unaccounted, Delta < 0: Missing)</span>'
    } else {
      this.outgoingExpTarget.classList.add('d-none')
    }
    if (!data.treasurySummary && !data.legacySummary) {
      return
    }
    // init treasury summary map
    if (treasurySummaryMap === null) {
      treasurySummaryMap = new Map()
      data.treasurySummary.forEach(treasury => {
        const tmpTreasury = {}
        Object.assign(tmpTreasury, treasury)
        treasurySummaryMap.set(treasury.month, tmpTreasury)
      })
    }
    let treasuryData = this.getTreasuryDataWithType(data)
    // if not init combined, hanlder data
    if (!combinedChartData || !combinedChartYearData) {
      this.handlerDataForCombinedChart(treasuryData)
    }
    if (treasuryData === null) {
      return
    }

    if (this.settings.interval === 'year') {
      treasuryData = this.getTreasuryYearlyData(treasuryData)
      combinedYearData = treasuryData
      this.yearSelectTitleTarget.classList.add('d-none')
      this.yearSelectTarget.classList.add('d-none')
    } else {
      this.yearSelectTitleTarget.classList.remove('d-none')
      this.yearSelectTarget.classList.remove('d-none')
      // init year select options
      this.initYearSelectOptions(treasuryData)
    }
    // filter by year
    if (this.settings.interval !== 'year' && this.settings.year && this.settings.year.toString() !== '0') {
      const tmpData = []
      treasuryData.forEach((treasury) => {
        const yearArr = treasury.month.split('-')
        if (yearArr.length < 2) {
          return
        }
        if (this.settings.year.toString() !== yearArr[0].trim()) {
          return
        }
        tmpData.push(treasury)
      })
      treasuryData = tmpData
    }

    if (this.settings.ttype === 'combined') {
      this.initLegacyBalanceMap(this.settings.interval === 'year' ? this.getTreasuryYearlyData(data.legacySummary) : data.legacySummary, this.settings.interval === 'year' ? combinedYearData : this.settings.tavg ? combinedAvgData : combinedData)
      this.initTreasuryBalanceMap(this.settings.interval === 'year' ? this.getTreasuryYearlyData(data.treasurySummary) : data.treasurySummary, this.settings.interval === 'year' ? combinedYearData : this.settings.tavg ? combinedAvgData : combinedData)
      this.initCombinedBalanceMap(treasuryData)
      this.specialTreasuryTarget.classList.add('d-none')
      this.treasuryTypeRateTarget.classList.remove('d-none')
    } else {
      this.specialTreasuryTarget.classList.remove('d-none')
      this.treasuryTypeRateTarget.classList.add('d-none')
    }
    this.reportTarget.innerHTML = this.createTreasuryLegacyTableContent(treasuryData, data.treasurySummary, data.legacySummary)
  }

  isCombinedReport () {
    return this.settings.type === 'treasury' && (this.settings.ttype === 'combined' || this.settings.ttype === '')
  }

  initYearSelectOptions (treasuryData) {
    const yearArr = []
    if (!treasuryData) {
      return
    }
    treasuryData.forEach((treasury) => {
      const timeArr = treasury.month.split('-')
      if (timeArr.length > 1) {
        const year = timeArr[0].trim()
        if (!yearArr.includes(year)) {
          yearArr.push(year)
        }
      }
    })
    let options = `<option name="all" value="0" ${!this.settings.year || this.settings.year === 0 ? 'selected' : ''}>All</option>`
    yearArr.forEach((year) => {
      options += `<option name="name_${year}" value="${year}" ${this.settings.year && this.settings.year.toString() === year ? 'selected' : ''}>${year}</option>`
    })
    this.yearSelectTarget.innerHTML = options
  }

  getTreasuryMonthSpentMap (treasurySummary) {
    const spentMap = new Map()
    if (!treasurySummary || treasurySummary.length < 1) {
      return spentMap
    }
    treasurySummary.forEach((summary) => {
      spentMap.set(summary.month, summary.outvalueUSD)
    })
    return spentMap
  }

  getTreasuryValueMapByMonth (treasurySummary) {
    const summaryMap = new Map()
    const result = new Map()
    treasurySummary.forEach((summary) => {
      summaryMap.set(summary.month, summary.balanceUSD)
    })
    const now = new Date()
    const month = now.getUTCMonth() + 1
    const year = now.getUTCFullYear()
    const nowCompare = this.settings.interval === 'year' ? year : year * 12 + month
    const lowestTime = treasurySummary[treasurySummary.length - 1].month
    const lowestArr = lowestTime.split('-')
    if (this.settings.interval !== 'year' && lowestArr.length < 2) {
      return result
    }
    const lowestYear = Number(lowestArr[0])
    let lowestMonth = 0
    if (this.settings.interval !== 'year') {
      // if month < 10
      let lowestMonthStr = ''
      if (lowestArr[1].charAt(0) === '0') {
        lowestMonthStr = lowestArr[1].substring(1, lowestArr[1].length)
      } else {
        lowestMonthStr = lowestArr[1]
      }
      lowestMonth = Number(lowestMonthStr)
    }

    const lowestCompare = this.settings.interval === 'year' ? lowestYear : lowestYear * 12 + lowestMonth
    // browse frome lowest to now
    let tempBalance = 0
    for (let i = lowestCompare; i <= nowCompare; i++) {
      let year = i
      let month = 0
      let key = ''
      if (this.settings.interval !== 'year') {
        month = i % 12
        year = (i - month) / 12
        if (month === 0) {
          year -= 1
          month = 12
        }
        key = year + '-' + (month < 10 ? '0' + month : month)
      } else {
        key = year.toString()
      }
      // check key on summary map
      if (summaryMap.has(key)) {
        tempBalance = summaryMap.get(key)
      }
      result.set(key, tempBalance)
    }
    return result
  }

  getTreasuryDataWithType (data) {
    if (this.settings.ttype === 'current') {
      return data.treasurySummary
    }
    if (this.settings.ttype === 'legacy') {
      return data.legacySummary
    }
    if (!this.settings.tavg && combinedData !== null) {
      return combinedData
    } else if (this.settings.tavg && combinedAvgData !== null) {
      return combinedAvgData
    }
    const _this = this
    // create time map
    const timeArr = []
    // return combined data
    const combinedDataMap = new Map()
    if (data.treasurySummary) {
      data.treasurySummary.forEach((treasury) => {
        timeArr.push(treasury.month)
        const tmpTreasury = {}
        Object.assign(tmpTreasury, treasury)
        combinedDataMap.set(treasury.month, tmpTreasury)
      })
    }
    if (data.legacySummary) {
      data.legacySummary.forEach((legacy) => {
        if (!timeArr.includes(legacy.month)) {
          timeArr.push(legacy.month)
          const tmpLegacy = {}
          Object.assign(tmpLegacy, legacy)
          combinedDataMap.set(legacy.month, tmpLegacy)
        } else if (combinedDataMap.has(legacy.month)) {
          // if has in array (in map)
          const item = combinedDataMap.get(legacy.month)
          let treasuryInvalue = item.invalue
          let legacyOutValue = legacy.outvalue
          let treasuryInvalueUSD = item.invalueUSD
          let legacyOutValueUSD = legacy.outvalueUSD
          if (item.taddValue && item.taddValue > 0) {
            treasuryInvalue = item.invalue - item.taddValue
            legacyOutValue = legacy.outvalue - item.taddValue
            treasuryInvalueUSD = item.invalueUSD - item.taddValueUSD
            legacyOutValueUSD = legacy.outvalueUSD - item.taddValueUSD
          }
          item.invalue = treasuryInvalue + legacy.invalue
          item.invalueUSD = treasuryInvalueUSD + legacy.invalueUSD
          item.outvalue += legacyOutValue
          item.outvalueUSD += legacyOutValueUSD
          item.total += legacy.total
          item.totalUSD += legacy.totalUSD
          item.difference = Math.abs(item.invalue - item.outvalue)
          item.differenceUSD = (item.difference / 100000000) * item.monthPrice
          combinedDataMap.set(legacy.month, item)
        }
      })
    }

    timeArr.sort(function (a, b) {
      const aTimeCompare = _this.getTimeCompare(a)
      const bTimeCompare = _this.getTimeCompare(b)
      if (aTimeCompare > bTimeCompare) {
        return 1
      }
      if (aTimeCompare < bTimeCompare) {
        return -1
      }
      return 0
    })

    const result = []
    let balanceTotal = 0.0
    timeArr.forEach((month) => {
      if (combinedDataMap.has(month)) {
        const dataItem = combinedDataMap.get(month)
        balanceTotal += dataItem.invalue - dataItem.outvalue
        dataItem.balance = balanceTotal
        dataItem.balanceUSD = (balanceTotal / 100000000) * dataItem.monthPrice
        result.push(dataItem)
      }
    })
    const mainResult = []
    for (let i = result.length - 1; i >= 0; i--) {
      mainResult.push(result[i])
    }
    if (this.settings.tavg) {
      combinedAvgData = mainResult
    } else {
      combinedData = mainResult
    }
    return mainResult
  }

  initLegacyBalanceMap (legacyData, combinedData) {
    if (this.settings.interval !== 'year' && adminBalanceMap != null) {
      return adminBalanceMap
    }
    if (this.settings.interval === 'year' && adminYearlyBalanceMap != null) {
      return adminYearlyBalanceMap
    }
    const tempHasDataBalancemap = new Map()
    legacyData.forEach(summary => {
      tempHasDataBalancemap.set(summary.month, summary.balance)
    })
    // for each combined data
    let currentBalance = 0
    const tempBalanceMap = new Map()
    for (let i = combinedData.length - 1; i >= 0; i--) {
      const combined = combinedData[i]
      if (tempHasDataBalancemap.has(combined.month)) {
        currentBalance = tempHasDataBalancemap.get(combined.month)
      }
      tempBalanceMap.set(combined.month, currentBalance)
    }
    if (this.settings.interval === 'year') {
      adminYearlyBalanceMap = tempBalanceMap
    } else {
      adminBalanceMap = tempBalanceMap
    }
    return tempBalanceMap
  }

  initTreasuryBalanceMap (treasuryData, combinedData) {
    if (this.settings.interval !== 'year' && treasuryBalanceMap != null) {
      return treasuryBalanceMap
    }
    if (this.settings.interval === 'year' && treasuryYearlyBalanceMap != null) {
      return treasuryYearlyBalanceMap
    }
    const tempHasDataBalancemap = new Map()
    treasuryData.forEach(summary => {
      tempHasDataBalancemap.set(summary.month, summary.balance)
    })
    // for each combined data
    let currentBalance = 0
    const tempBalanceMap = new Map()
    for (let i = combinedData.length - 1; i >= 0; i--) {
      const combined = combinedData[i]
      if (tempHasDataBalancemap.has(combined.month)) {
        currentBalance = tempHasDataBalancemap.get(combined.month)
      }
      tempBalanceMap.set(combined.month, currentBalance)
    }
    if (this.settings.interval === 'year') {
      treasuryYearlyBalanceMap = tempBalanceMap
    } else {
      treasuryBalanceMap = tempBalanceMap
    }
    return tempBalanceMap
  }

  initCombinedBalanceMap (summaryData) {
    if (this.settings.interval === 'year' && combinedYearlyBalanceMap != null) {
      return combinedYearlyBalanceMap
    }
    if (this.settings.interval !== 'year' && combineBalanceMap != null) {
      return combineBalanceMap
    }
    const tmpCombineBalanceMap = new Map()
    summaryData.forEach(summary => {
      tmpCombineBalanceMap.set(summary.month, summary.balance)
    })

    if (this.settings.interval === 'year') {
      combinedYearlyBalanceMap = tmpCombineBalanceMap
    } else {
      combineBalanceMap = tmpCombineBalanceMap
    }
    return tmpCombineBalanceMap
  }

  getTimeCompare (timStr) {
    const aTimeSplit = timStr.split('-')
    let year = 0
    let month = 0
    if (aTimeSplit.length >= 2) {
      // year
      year = parseInt(aTimeSplit[0])
      // if month < 10
      if (aTimeSplit[1].charAt(0) === '0') {
        month = parseInt(aTimeSplit[1].substring(1, aTimeSplit[1].length))
      } else {
        month = parseInt(aTimeSplit[1])
      }
    } else {
      return 0
    }

    return year * 12 + month
  }

  createTreasuryLegacyTableContent (summary, treasurySummary, legacySummary) {
    const isLegacy = this.settings.ttype === 'legacy'
    const isCombined = !this.settings.ttype || this.settings.ttype === '' || this.settings.ttype === 'combined'
    const isDecentralized = this.settings.ttype === 'current'
    // create row 1
    let thead = '<col><colgroup span="2"></colgroup><thead>' +
      '<tr class="text-secondary finance-table-header">' +
      `<th rowspan="2" class="va-mid text-center ps-0 month-col cursor-pointer" data-action="click->financereport#sortByCreateDate"><span class="${this.settings.tsort === 'newest' ? 'dcricon-arrow-down' : 'dcricon-arrow-up'} ${this.settings.stype && this.settings.stype !== '' ? 'c-grey-4' : ''} col-sort"></span></th>`
    const usdDisp = this.settings.usd === true || this.settings.usd === 'true'
    let row2 = '<tr class="text-secondary finance-table-header">'
    thead += '<th rowspan="2" class="va-mid text-right-i fs-13i px-2 fw-600 treasury-content-cell">Rate (USD/DCR)</th>' +
      '<th colspan="2" scope="colgroup" class="va-mid text-center-i fs-13i fw-600"><label class="cursor-pointer" data-action="click->financereport#sortByIncoming">Received</label>' +
      `<span data-action="click->financereport#sortByIncoming" class="${(this.settings.stype === 'incoming' && this.settings.order === 'desc') ? 'dcricon-arrow-down' : 'dcricon-arrow-up'} ${this.settings.stype !== 'incoming' ? 'c-grey-4' : ''} col-sort ms-1"></span></th>` +
      '<th colspan="2" scope="colgroup" class="va-mid text-center-i fs-13i fw-600"><label class="cursor-pointer" data-action="click->financereport#sortByOutgoing">Spent</label>' +
      `<span data-action="click->financereport#sortByOutgoing" class="${(this.settings.stype === 'outgoing' && this.settings.order === 'desc') ? 'dcricon-arrow-down' : 'dcricon-arrow-up'} ${this.settings.stype !== 'outgoing' ? 'c-grey-4' : ''} col-sort ms-1"></span></th>` +
      '<th colspan="2" scope="colgroup" class="va-mid text-center-i fs-13i fw-600">Net</th>' +
      '<th colspan="2" scope="colgroup" class="va-mid text-center-i fs-13i fw-600"><label class="cursor-pointer" data-action="click->financereport#sortByBalance">Balance</label>' +
      `<span data-action="click->financereport#sortByBalance" class="${(this.settings.stype === 'balance' && this.settings.order === 'desc') ? 'dcricon-arrow-down' : 'dcricon-arrow-up'} ${this.settings.stype !== 'balance' ? 'c-grey-4' : ''} col-sort ms-1"></span></th>`
    row2 += '<th scope="col" class="va-mid text-center-i fs-13i fw-600">DCR</th>' +
      '<th scope="col" class="va-mid text-center-i fs-13i fw-600">USD</th>' +
      '<th scope="col" class="va-mid text-center-i fs-13i fw-600">DCR</th>' +
      '<th scope="col" class="va-mid text-center-i fs-13i fw-600">USD</th>' +
      '<th scope="col" class="va-mid text-center-i fs-13i fw-600">DCR</th>' +
      '<th scope="col" class="va-mid text-center-i fs-13i fw-600">USD</th>' +
      '<th scope="col" class="va-mid text-center-i fs-13i fw-600">DCR</th>' +
      '<th scope="col" class="va-mid text-center-i fs-13i fw-600">USD</th>'
    if (isCombined) {
      thead += '<th colspan="2" scope="colgroup" class="va-mid text-center-i fs-13i fw-600">Dev Spent (Est)</th>' +
        '<th rowspan="2" class="va-mid text-right-i fs-13i px-2 fw-600 treasury-content-cell">Dev Spent (%)</th>' +
        '<th colspan="2" scope="colgroup" class="va-mid text-center-i fs-13i fw-600">Delta (Est)</th>'
      row2 += '<th scope="col" class="va-mid text-center-i fs-13i fw-600">DCR</th>' +
        '<th scope="col" class="va-mid text-center-i fs-13i fw-600">USD</th>' +
        '<th scope="col" class="va-mid text-center-i fs-13i fw-600">DCR</th>' +
        '<th scope="col" class="va-mid text-center-i fs-13i fw-600">USD</th>'
    }
    thead += '</tr>'
    row2 += '</tr>'

    // add row 2
    thead += row2
    thead += '</thead>'
    let tbody = '<tbody>###</tbody>'
    let bodyList = ''
    // create tbody content
    let incomeTotal = 0; let outTotal = 0; let estimateOutTotal = 0
    let incomeUSDTotal = 0; let outUSDTotal = 0; let estimateOutUSDTotal = 0
    let lastBalance = 0; let lastBalanceUSD = 0
    let unaccountedTotal = 0; let unaccountedUSDTotal = 0
    let lastTreasuryItem, lastAdminItem
    let lastMonth = ''
    if (summary.length > 0) {
      lastBalance = summary[0].balance
      lastBalanceUSD = summary[0].balanceUSD
      lastMonth = summary[0].month
    }
    if (treasurySummary.length > 0) {
      lastTreasuryItem = treasurySummary[0]
    }
    if (legacySummary.length > 0) {
      lastAdminItem = legacySummary[0]
    }
    // display balance in top
    if (!isCombined) {
      this.treasuryBalanceDisplayTarget.textContent = humanize.formatToLocalString((lastBalance / 100000000), 2, 2) + ' DCR'
      this.treasuryBalanceRateTarget.textContent = '~$' + humanize.formatToLocalString(lastBalanceUSD, 2, 2)
      this.treasuryBalanceCardTarget.classList.remove('col-md-16', 'col-xl-12', 'col-xxl-8')
      this.treasuryBalanceCardTarget.classList.add('col-sm-12', 'col-lg-8', 'col-xl-6', 'col-xxl-5')
      this.subTreasuryTitleTarget.textContent = (isLegacy ? 'Admin' : 'Decentralized') + ' Balance'
    } else {
      this.treasuryBalanceCardTarget.classList.remove('col-sm-12', 'col-lg-8', 'col-xl-6', 'col-xxl-5')
      this.treasuryBalanceCardTarget.classList.add('col-md-16', 'col-xl-12', 'col-xxl-8')
    }
    const balanceMap = this.settings.interval === 'year' ? combinedYearlyBalanceMap : combineBalanceMap
    if (isCombined && lastMonth !== '' && balanceMap.has(lastMonth)) {
      const combined = balanceMap.get(lastMonth)
      let legacy = 0; let tresury = 0
      let legacyUSD = 0; let treasuryUSD = 0
      if (lastAdminItem) {
        legacy = lastAdminItem.balance
        legacyUSD = lastAdminItem.balanceUSD
      }
      if (lastTreasuryItem) {
        tresury = lastTreasuryItem.balance
        treasuryUSD = lastTreasuryItem.balanceUSD
      }
      const lastLegacyRate = 100 * legacy / combined
      const lastTreasuryRate = 100 * tresury / combined
      this.treasuryLegacyPercentTarget.textContent = `${humanize.formatToLocalString((lastBalance / 100000000), 2, 2)} DCR`
      this.treasuryLegacyRateTarget.textContent = '~$' + humanize.formatToLocalString((lastBalanceUSD), 2, 2)
      this.decentralizedDataTarget.textContent = `${humanize.formatToLocalString((tresury / 100000000), 2, 2)} DCR`
      this.decentralizedDataRateTarget.textContent = '~$' + humanize.formatToLocalString(treasuryUSD, 2, 2)
      this.decentralizedTitleTarget.textContent = 'Decentralized (' + humanize.formatToLocalString(lastTreasuryRate, 2, 2) + '%)'
      this.adminDataTarget.textContent = `${humanize.formatToLocalString((legacy / 100000000), 2, 2)} DCR`
      this.adminDataRateTarget.textContent = '~$' + humanize.formatToLocalString(legacyUSD, 2, 2)
      this.adminTitleTarget.textContent = 'Admin (' + humanize.formatToLocalString(lastLegacyRate, 2, 2) + '%)'
    }
    const treasuryList = this.sortTreasury(summary)
    const _this = this
    treasuryList.forEach((item) => {
      const timeParam = _this.getFullTimeParam(item.month, '-')
      incomeTotal += item.invalue
      incomeUSDTotal += item.invalueUSD
      outTotal += item.outvalue
      outUSDTotal += item.outvalueUSD
      estimateOutTotal += item.outEstimate
      estimateOutUSDTotal += item.outEstimateUsd
      let taddValue = 0
      let taddValueUSD = 0
      if (isLegacy) {
        if (treasurySummaryMap.has(item.month)) {
          const existTreasury = treasurySummaryMap.get(item.month)
          taddValue = existTreasury.taddValue
          taddValueUSD = existTreasury.taddValueUSD
        }
      } else {
        taddValue = item.taddValue
        taddValueUSD = item.taddValueUSD
      }
      const netNegative = item.outvalue > item.invalue
      const incomDisplay = item.invalue <= 0 ? '-' : humanize.formatToLocalString((item.invalue / 100000000), 2, 2)
      const incomUSDDisplay = item.invalue <= 0 ? '' : humanize.formatToLocalString(item.invalueUSD, 2, 2)
      const outcomeDisplay = item.outvalue <= 0 ? '-' : humanize.formatToLocalString((item.outvalue / 100000000), 2, 2)
      const outcomeUSDDisplay = item.outvalue <= 0 ? '' : humanize.formatToLocalString(item.outvalueUSD, 2, 2)
      const differenceDisplay = item.difference <= 0 ? '' : humanize.formatToLocalString((item.difference / 100000000), 2, 2)
      const differenceUSDDisplay = item.difference <= 0 ? '' : humanize.formatToLocalString(item.differenceUSD, 2, 2)
      const balanceDisplay = item.balance <= 0 ? '' : humanize.formatToLocalString((item.balance / 100000000), 2, 2)
      const balanceUSDDisplay = item.balance <= 0 ? '' : humanize.formatToLocalString(item.balanceUSD, 2, 2)
      let incomeHref = ''
      let outcomeHref = ''
      if (!isCombined) {
        incomeHref = item.invalue > 0 ? item.creditLink : ''
        outcomeHref = item.outvalue > 0 ? item.debitLink : ''
      }
      bodyList += '<tr class="odd-even-row">' +
        `<td class="va-mid text-center fs-13i fw-600"><a class="link-hover-underline fs-13i" data-turbolinks="false" href="${'/finance-report?type=bytime&' + (this.settings.interval === 'year' ? '' : 'dtype=month&') + '&dtime=' + (timeParam === '' ? item.month : timeParam)}">${item.month}</a></td>` +
        `<td class="va-mid text-right-i ps-2 fs-13i treasury-content-cell">$${humanize.formatToLocalString(item.monthPrice, 2, 2)}</td>` +
        `<td class="va-mid text-right-i ps-2 fs-13i treasury-content-cell ${!isLegacy && taddValue > 0 ? 'special-cell' : ''}">${incomeHref !== '' ? '<a class="link-hover-underline fs-13i" data-turbolinks="false" href="' + incomeHref + '">' : ''}${incomDisplay}${incomeHref !== '' ? '</a>' : ''}`
      if (!isLegacy && taddValue > 0) {
        bodyList += `<span class="dcricon-info cursor-pointer cell-tooltip ms-1" data-action="click->financereport#showIngoingTaddTooltip" data-show="${(taddValue / 1e8) + ';' + taddValueUSD}"><span class="tooltiptext cursor-default click-popup" style="text-align: left; line-height: 1rem;"><span class="tooltip-text d-flex ai-center"></span></span></span>`
      }
      bodyList += '</td>' +
        `<td class="va-mid text-right-i ps-2 fs-13i treasury-content-cell">${incomUSDDisplay !== '' ? '$' + incomUSDDisplay : '-'}</td>` +
        `<td class="va-mid text-right-i ps-2 fs-13i treasury-content-cell ${!isDecentralized && taddValue > 0 ? 'special-cell' : ''}">${outcomeHref !== '' ? '<a class="link-hover-underline fs-13i" data-turbolinks="false" href="' + outcomeHref + '">' : ''}${outcomeDisplay}${outcomeHref !== '' ? '</a>' : ''}`
      if (!isDecentralized && taddValue > 0) {
        bodyList += `<span class="dcricon-info cursor-pointer cell-tooltip ms-1" data-action="click->financereport#showOutgoingTaddTooltip" data-show="${(taddValue / 1e8) + ';' + taddValueUSD}"><span class="tooltiptext cursor-default click-popup" style="text-align: left; line-height: 1rem;"><span class="tooltip-text d-flex ai-center"></span></span></span>`
      }
      bodyList += '</td>' +
        `<td class="va-mid text-right-i ps-2 fs-13i treasury-content-cell">${outcomeUSDDisplay !== '' ? '$' + outcomeUSDDisplay : '-'}</td>` +
        `<td class="va-mid text-right-i ps-2 fs-13i treasury-content-cell">${netNegative ? '-' : ''}${differenceDisplay !== '' ? differenceDisplay : '-'}</td>` +
        `<td class="va-mid text-right-i ps-2 fs-13i treasury-content-cell">${netNegative ? '-' : ''}${differenceUSDDisplay !== '' ? '$' + differenceUSDDisplay : '-'}</td>` +
        `<td class="va-mid ps-2 text-right-i fs-13i treasury-content-cell">${balanceDisplay !== '' ? balanceDisplay : '-'}</td>` +
        `<td class="va-mid text-right-i ps-2 fs-13i treasury-content-cell">${balanceUSDDisplay !== '' ? '$' + balanceUSDDisplay : '-'}</td>`
      if (isCombined) {
        // calculate dev spent percent
        let devSentPercent = 0
        if (item.outvalue > 0) {
          devSentPercent = 100 * 1e8 * item.outEstimate / item.outvalue
        }
        const unaccounted = item.outvalue - 1e8 * item.outEstimate
        unaccountedTotal += unaccounted
        const unaccountedUSD = item.outvalueUSD - item.outEstimateUsd
        unaccountedUSDTotal += unaccountedUSD
        bodyList += `<td class="va-mid ps-2 text-right-i fs-13i treasury-content-cell">${item.outEstimate === 0.0 ? '-' : humanize.formatToLocalString(item.outEstimate, 2, 2)}</td>` +
          `<td class="va-mid text-right-i ps-2 fs-13i treasury-content-cell">${item.outEstimate !== 0.0 ? '$' + humanize.formatToLocalString(item.outEstimateUsd, 2, 2) : '-'}</td>` +
          `<td class="va-mid ps-2 text-right-i fs-13i treasury-content-cell">${devSentPercent === 0.0 ? '-' : humanize.formatToLocalString(devSentPercent, 2, 2) + '%'}</td>` +
          `<td class="va-mid ps-2 text-right-i fs-13i treasury-content-cell">${unaccounted === 0 ? '-' : (unaccounted < 0 ? '-' : '') + humanize.formatToLocalString(Math.abs(unaccounted) / 100000000, 2, 2)}`
        if (unaccounted > 0) {
          bodyList += `<span class="dcricon-info cursor-pointer cell-tooltip ms-1" data-action="click->financereport#showUnaccountedTooltip" data-show="${item.outvalue / 100000000 + ';' + item.outEstimate}"><span class="tooltiptext cursor-default move-left-click-popup"><span class="tooltip-text d-flex ai-center"></span></span></span>`
        }
        bodyList += `</td><td class="va-mid text-right-i ps-2 fs-13i treasury-content-cell">${unaccountedUSD === 0 ? '-' : (unaccountedUSD < 0 ? '-' : '') + '$' + humanize.formatToLocalString(Math.abs(unaccountedUSD), 2, 2)}</td>`
      }
      // Display month price of decred
      bodyList += '</tr>'
    })
    const totalIncomDisplay = humanize.formatToLocalString((incomeTotal / 100000000), 2, 2)
    const totalIncomUSDDisplay = humanize.formatToLocalString(incomeUSDTotal, 2, 2)
    const totalOutcomeDisplay = humanize.formatToLocalString((outTotal / 100000000), 2, 2)
    const totalOutcomeUSDDisplay = humanize.formatToLocalString(outUSDTotal, 2, 2)
    const totalEstimateOutgoing = humanize.formatToLocalString(estimateOutTotal, 2, 2)
    const totalEstimateOutUSDgoing = humanize.formatToLocalString(estimateOutUSDTotal, 2, 2)
    const lastBalanceDisplay = humanize.formatToLocalString((lastBalance / 100000000), 2, 2)
    const lastBalanceUSDDisplay = humanize.formatToLocalString(lastBalanceUSD, 2, 2)
    const totalBalanceNegative = lastBalance < 0.0
    bodyList += '<tr class="va-mid finance-table-header finance-table-footer last-row-header"><td class="text-center fw-600 fs-13i border-right-grey">Total</td>' +
      '<td class="va-mid text-right-i fw-600 fs-13i ps-2 treasury-content-cell">-</td>' +
      `<td class="va-mid text-right-i ps-2 fw-600 fs-13i treasury-content-cell">${totalIncomDisplay}</td>` +
      `<td class="va-mid text-right-i ps-2 fw-600 fs-13i treasury-content-cell">${incomeUSDTotal > 0 ? '$' : ''}${totalIncomUSDDisplay}</td>` +
      `<td class="va-mid text-right-i ps-2 fw-600 fs-13i treasury-content-cell">${totalOutcomeDisplay}</td>` +
      `<td class="va-mid text-right-i ps-2 fw-600 fs-13i treasury-content-cell">${outUSDTotal > 0 ? '$' : ''}${totalOutcomeUSDDisplay}</td>` +
      '<td class="va-mid text-right-i ps-2 fw-600 fs-13i treasury-content-cell">-</td><td class="va-mid text-right-i fw-600 fs-13i treasury-content-cell">-</td>' +
      `<td class="va-mid text-right-i ps-2 fw-600 fs-13i treasury-content-cell">${totalBalanceNegative ? '-' : ''}${lastBalanceDisplay}</td>` +
      `<td class="va-mid text-right-i ps-2 fw-600 fs-13i treasury-content-cell">${lastBalanceUSD > 0 ? '$' : ''}${totalBalanceNegative ? '-' : ''}${usdDisp ? '$' : ''}${lastBalanceUSDDisplay}</td>`
    if (isCombined) {
      bodyList += `<td class="va-mid text-right-i ps-2 fw-600 fs-13i treasury-content-cell">${totalEstimateOutgoing}</td>` +
        `<td class="va-mid text-right-i ps-2 fw-600 fs-13i treasury-content-cell">${estimateOutUSDTotal > 0 ? '$' : ''}${totalEstimateOutUSDgoing}</td>` +
        '<td class="va-mid text-right-i fw-600 fs-13i treasury-content-cell">-</td>' +
        `<td class="va-mid ps-2 text-right-i fw-600 fs-13i treasury-content-cell">${unaccountedTotal === 0 ? '-' : (unaccountedTotal < 0 ? '-' : '') + humanize.formatToLocalString(Math.abs(unaccountedTotal / 100000000), 2, 2)}</td>` +
        `<td class="va-mid text-right-i ps-2 fw-600 fs-13i treasury-content-cell">${unaccountedUSDTotal === 0 ? '-' : (unaccountedUSDTotal < 0 ? '-' : '') + '$' + humanize.formatToLocalString(Math.abs(unaccountedUSDTotal), 2, 2)}</td>`
    }
    bodyList += '</tr>'
    tbody = tbody.replace('###', bodyList)
    return thead + tbody
  }

  getProposalResponse (pResponse) {
    if (!this.settings.tavg || !pResponse.treasurySummary || pResponse.treasurySummary.length < 1) {
      return pResponse
    }
    const res = {}
    Object.assign(res, pResponse)
    const treasurySum = []
    const treasuryYearlyData = this.getTreasuryYearlyData(pResponse.treasurySummary)
    const treasuryMonthAvgMap = new Map()
    const _this = this
    if (treasuryYearlyData && treasuryYearlyData.length > 0) {
      treasuryYearlyData.forEach((yearData) => {
        const numOfMonth = _this.countMonthOnYearData(yearData.month, pResponse.treasurySummary)
        if (numOfMonth > 0) {
          treasuryMonthAvgMap.set(yearData.month, { invalue: yearData.invalue / numOfMonth, outvalue: yearData.outvalue / numOfMonth })
        }
      })
      pResponse.treasurySummary.forEach((tSummary) => {
        const tmpTreasury = {}
        Object.assign(tmpTreasury, tSummary)
        if (tmpTreasury.month) {
          const year = tmpTreasury.month.split('-')[0]
          if (treasuryMonthAvgMap.has(year)) {
            tmpTreasury.invalue = treasuryMonthAvgMap.get(year).invalue
            tmpTreasury.outvalue = treasuryMonthAvgMap.get(year).outvalue
            tmpTreasury.invalueUSD = tmpTreasury.monthPrice * (tmpTreasury.invalue / 1e8)
            tmpTreasury.outvalueUSD = tmpTreasury.monthPrice * (tmpTreasury.outvalue / 1e8)
            tmpTreasury.difference = Math.abs(tmpTreasury.invalue - tmpTreasury.outvalue)
            tmpTreasury.differenceUSD = Math.abs(tmpTreasury.invalueUSD - tmpTreasury.outvalueUSD)
            tmpTreasury.total = tmpTreasury.invalue + tmpTreasury.outvalue
            tmpTreasury.totalUSD = tmpTreasury.invalueUSD + tmpTreasury.outvalueUSD
          }
        }
        treasurySum.push(tmpTreasury)
      })
    }
    res.treasurySummary = treasurySum
    return res
  }

  countMonthOnYearData (yearStr, treasuryData) {
    let count = 0
    treasuryData.forEach((tData) => {
      if (tData.month.startsWith(yearStr)) {
        count++
      }
    })
    return count
  }

  getTreasuryResponse (tResponse) {
    if (!this.settings.tavg) {
      return tResponse
    }
    const res = {}
    const treasurySum = []
    const legacySum = []
    const treasuryYearlyData = this.getTreasuryYearlyData(tResponse.treasurySummary)
    const legacyYearlyData = this.getTreasuryYearlyData(tResponse.legacySummary)
    const treasuryMonthAvgMap = new Map()
    const legacyMonthAvgMap = new Map()
    const taddMonthValueMap = new Map()
    const taddYearValueMap = new Map()
    const _this = this
    if (treasuryYearlyData && treasuryYearlyData.length > 0) {
      treasuryYearlyData.forEach((yearData) => {
        const numOfMonth = _this.countMonthOnYearData(yearData.month, tResponse.treasurySummary)
        if (numOfMonth > 0) {
          treasuryMonthAvgMap.set(yearData.month, { invalue: (yearData.invalue - yearData.taddValue) / numOfMonth, outvalue: yearData.outvalue / numOfMonth })
          taddYearValueMap.set(yearData.month, yearData.taddValue)
        }
      })
      tResponse.treasurySummary.forEach((tSummary) => {
        const tmpTreasury = {}
        Object.assign(tmpTreasury, tSummary)
        if (tmpTreasury.month) {
          const year = tmpTreasury.month.split('-')[0]
          if (treasuryMonthAvgMap.has(year)) {
            taddMonthValueMap.set(tmpTreasury.month, tmpTreasury.taddValue)
            tmpTreasury.invalue = treasuryMonthAvgMap.get(year).invalue
            if (tmpTreasury.taddValue > 0) {
              tmpTreasury.invalue += tmpTreasury.taddValue
            }
            tmpTreasury.outvalue = treasuryMonthAvgMap.get(year).outvalue
            tmpTreasury.invalueUSD = tmpTreasury.monthPrice * (tmpTreasury.invalue / 1e8)
            tmpTreasury.outvalueUSD = tmpTreasury.monthPrice * (tmpTreasury.outvalue / 1e8)
            tmpTreasury.difference = Math.abs(tmpTreasury.invalue - tmpTreasury.outvalue)
            tmpTreasury.differenceUSD = Math.abs(tmpTreasury.invalueUSD - tmpTreasury.outvalueUSD)
            tmpTreasury.total = tmpTreasury.invalue + tmpTreasury.outvalue
            tmpTreasury.totalUSD = tmpTreasury.invalueUSD + tmpTreasury.outvalueUSD
            tmpTreasury.devSpentPercent = tmpTreasury.outvalue > 0 ? 100 * (tmpTreasury.outEstimate / tmpTreasury.outvalue) : 0
          }
        }
        treasurySum.push(tmpTreasury)
      })
    }

    if (legacyYearlyData && legacyYearlyData.length > 0) {
      legacyYearlyData.forEach((yearData) => {
        const numOfMonth = _this.countMonthOnYearData(yearData.month, tResponse.legacySummary)
        if (numOfMonth > 0) {
          let tadd = 0
          if (taddYearValueMap.has(yearData.month)) {
            tadd = taddYearValueMap.get(yearData.month) > 0 ? taddYearValueMap.get(yearData.month) : 0
          }
          legacyMonthAvgMap.set(yearData.month, { invalue: yearData.invalue / numOfMonth, outvalue: (yearData.outvalue - tadd) / numOfMonth })
        }
      })
      tResponse.legacySummary.forEach((lSummary) => {
        const tmpTreasury = {}
        Object.assign(tmpTreasury, lSummary)
        if (tmpTreasury.month) {
          const year = tmpTreasury.month.split('-')[0]
          if (legacyMonthAvgMap.has(year)) {
            let tadd = 0
            if (taddMonthValueMap.has(tmpTreasury.month)) {
              tadd = taddMonthValueMap.get(tmpTreasury.month) > 0 ? taddMonthValueMap.get(tmpTreasury.month) : 0
            }
            tmpTreasury.invalue = legacyMonthAvgMap.get(year).invalue
            tmpTreasury.outvalue = legacyMonthAvgMap.get(year).outvalue + tadd
            tmpTreasury.invalueUSD = tmpTreasury.monthPrice * (tmpTreasury.invalue / 1e8)
            tmpTreasury.outvalueUSD = tmpTreasury.monthPrice * (tmpTreasury.outvalue / 1e8)
            tmpTreasury.difference = Math.abs(tmpTreasury.invalue - tmpTreasury.outvalue)
            tmpTreasury.differenceUSD = Math.abs(tmpTreasury.invalueUSD - tmpTreasury.outvalueUSD)
            tmpTreasury.total = tmpTreasury.invalue + tmpTreasury.outvalue
            tmpTreasury.totalUSD = tmpTreasury.invalueUSD + tmpTreasury.outvalueUSD
          }
        }
        legacySum.push(tmpTreasury)
      })
    }
    res.treasurySummary = treasurySum
    res.legacySummary = legacySum
    return res
  }

  // Calculate and response
  async calculate () {
    this.pageLoaderTarget.classList.add('loading')
    this.setReportTitle()
    if (this.isTreasuryReport() || this.isDomainType()) {
      this.intervalTargets.forEach((intervalTarget) => {
        intervalTarget.classList.remove('active')
        if (intervalTarget.name === this.settings.interval) {
          intervalTarget.classList.add('active')
        }
      })
    }
    if (this.isTreasuryReport()) {
      this.searchBoxTarget.classList.add('d-none')
      this.searchBoxTarget.classList.remove('report-search-box')
      this.colorNoteRowTarget.classList.add('d-none')
      this.searchInputTarget.value = ''
      this.settings.search = this.defaultSettings.search
    } else {
      if (this.settings.type !== 'domain') {
        this.settings.chart = this.defaultSettings.chart
      }
      this.searchBoxTarget.classList.remove('d-none')
      this.searchBoxTarget.classList.add('report-search-box')
      if (((this.settings.pgroup === '' || this.settings.pgroup === 'proposals') && this.settings.type === 'summary') || (this.settings.pgroup === 'authors' && this.settings.ptype === 'list')) {
        this.searchBoxTarget.classList.add('ms-3')
      } else {
        this.searchBoxTarget.classList.remove('ms-3')
      }
      this.settings.usd = false
    }

    if (this.isNullValue(this.settings.type) || this.settings.type === 'proposal' || this.settings.type === 'summary') {
      this.proposalSelectTypeTarget.classList.remove('d-none')
      document.getElementById('nameMonthSwitchInput').checked = this.isMonthDisplay
      if ((this.settings.pgroup === 'proposals' && this.settings.type === 'summary') || (this.settings.pgroup === 'authors' && this.settings.ptype === 'list')) {
        this.colorLabelTarget.classList.remove('proposal-note-color')
        this.colorLabelTarget.classList.add('summary-note-color')
        this.reportDescriptionTarget.classList.remove('d-none')
      } else if ((this.settings.pgroup === 'proposals' && (this.settings.type === 'proposal' || this.settings.type === '')) || (this.settings.pgroup === 'authors' && this.settings.ptype !== 'list')) {
        this.colorLabelTarget.classList.remove('summary-note-color')
        this.colorLabelTarget.classList.add('proposal-note-color')
        this.reportDescriptionTarget.classList.add('d-none')
        this.colorDescriptionTarget.textContent = (this.settings.interval === 'year' ? 'Valid payment year (Estimated based on total budget and time period of proposal)' : 'Valid payment month (Estimated based on total budget and time period of proposal)')
      } else {
        this.reportDescriptionTarget.classList.remove('d-none')
      }

      if (this.settings.pgroup === 'domains') {
        this.domainFutureRowTarget.classList.remove('d-none')
      } else {
        this.domainFutureRowTarget.classList.add('d-none')
      }

      // handler for group type
      if (this.settings.pgroup === 'proposals') {
        this.nameMatrixSwitchTarget.classList.remove('d-none')
        this.colorNoteRowTarget.classList.remove('d-none')
        if (this.settings.type === 'summary') {
          this.colorLabelTarget.classList.remove('proposal-note-color')
          this.colorLabelTarget.classList.add('summary-note-color')
          this.colorDescriptionTarget.textContent = 'The proposals are still active'
        } else {
          this.colorLabelTarget.classList.remove('summary-note-color')
          this.colorLabelTarget.classList.add('proposal-note-color')
        }
      } else if (this.settings.pgroup === 'domains') {
        this.nameMatrixSwitchTarget.classList.add('d-none')
        this.colorNoteRowTarget.classList.add('d-none')
      } else if (this.settings.pgroup === 'authors') {
        this.colorNoteRowTarget.classList.remove('d-none')
        this.nameMatrixSwitchTarget.classList.remove('d-none')
        if (this.settings.ptype === 'list') {
          this.colorDescriptionTarget.textContent = 'The authors are still active'
        }
      }
    } else {
      this.nameMatrixSwitchTarget.classList.add('d-none')
      this.proposalSelectTypeTarget.classList.add('d-none')
      this.reportDescriptionTarget.classList.remove('d-none')
      this.domainFutureRowTarget.classList.add('d-none')
    }
    // disabled group button for loading
    this.disabledGroupButton()
    if (!this.settings.search || this.settings.search === '') {
      let haveResponseData
      // if got report. ignore get by api
      if (this.settings.type === 'treasury') {
        if (treasuryResponse !== null) {
          responseData = this.getTreasuryResponse(treasuryResponse)
          haveResponseData = true
        }
      } else if (proposalResponse !== null) {
        responseData = this.getProposalResponse(proposalResponse)
        haveResponseData = true
      }

      if (haveResponseData) {
        if (this.isDomainType()) {
          this.handlerDomainYearlyData(responseData)
        }
        this.handlerDataForDomainChart(responseData)
        this.createReportTable()
        this.enabledGroupButton()
        this.pageLoaderTarget.classList.remove('loading')
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
    responseData = response && this.settings.type === 'treasury' ? this.getTreasuryResponse(response) : this.getProposalResponse(response)
    if (this.isDomainType()) {
      this.handlerDomainYearlyData(responseData)
    }
    // handler for domain chart
    this.handlerDataForDomainChart(response)
    if (!this.settings.search || this.settings.search === '') {
      if (this.settings.type === 'treasury') {
        treasuryResponse = response
      } else {
        proposalResponse = response
      }
    }
    this.createReportTable()
    this.enabledGroupButton()
    this.pageLoaderTarget.classList.remove('loading')
  }

  handlerDomainYearlyData (data) {
    const treasuryDataMap = this.getTreasuryMonthSpentMap(data.treasurySummary)
    const handlerData = this.getTreasuryDomainCombined(data, treasuryDataMap)
    domainYearData = this.getProposalYearlyData(handlerData)
  }

  isMobile () {
    try { document.createEvent('TouchEvent'); return true } catch (e) { return false }
  }

  handlerDataForCombinedChart (data) {
    if (combinedChartData !== null && combinedChartYearData !== null) {
      return
    }
    if (!data || data.length === 0) {
      combinedChartData = {}
      combinedChartYearData = {}
      return
    }

    combinedChartData = this.getDataForCombinedChart(data, 'month')
    const treasuryYearlyData = this.getTreasuryYearlyData(data)
    combinedChartYearData = this.getDataForCombinedChart(treasuryYearlyData, 'year')
  }

  getDataForCombinedChart (data, type) {
    const timeArr = []
    const spentArr = []
    const receivedArr = []
    const netArr = []
    for (let i = data.length - 1; i >= 0; i--) {
      const item = data[i]
      if (type === 'month') {
        timeArr.push(item.month + '-01T07:00:00Z')
      } else {
        timeArr.push(item.month + '-01-01T07:00:00Z')
      }
      spentArr.push(item.outvalue / 100000000)
      receivedArr.push(item.invalue / 100000000)
      netArr.push((item.invalue - item.outvalue) / 100000000)
    }
    const result = {
      time: timeArr,
      received: receivedArr,
      sent: spentArr,
      net: netArr
    }
    return result
  }

  handlerDataForDomainChart (data) {
    // if data is existed, skip
    if (domainChartData !== null && domainChartYearData !== null) {
      return
    }
    if (!data.report || data.report.length === 0) {
      domainChartData = null
      domainChartYearData = null
      return
    }
    // get monthly data
    domainChartData = this.getDataOfDomainChart(data, 'month')
    if (domainYearData != null) {
      domainChartYearData = this.getDataOfDomainChart(domainYearData, 'year')
    }
  }

  getDataOfDomainChart (data, type) {
    // handler for yearlydata
    const timeArr = []
    const marketingArr = []
    const developmentArr = []
    const virtualNetArr = []
    for (let i = data.report.length - 1; i >= 0; i--) {
      const item = data.report[i]
      if (type === 'month') {
        timeArr.push(item.month.replace('/', '-') + '-01T07:00:00Z')
      } else {
        timeArr.push(item.month + '-01-01T07:00:00Z')
      }
      virtualNetArr.push(0)
      let hasMarketing = false
      let hasDevelopment = false
      item.domainData.forEach((domainData) => {
        if (domainData.domain === 'marketing') {
          marketingArr.push(domainData.expense)
          hasMarketing = true
        } else if (domainData.domain === 'development') {
          developmentArr.push(domainData.expense)
          hasDevelopment = true
        }
      })
      if (!hasMarketing) {
        marketingArr.push(0)
      }
      if (!hasDevelopment) {
        developmentArr.push(0)
      }
    }
    const result = {
      time: timeArr,
      marketing: marketingArr,
      development: developmentArr
    }
    return result
  }

  enabledGroupButton () {
    // enabled group button after loading
    this.intervalTargets.forEach((intervalTarget) => {
      intervalTarget.disabled = false
    })
  }

  disabledGroupButton () {
    // disabled group button after loading
    this.intervalTargets.forEach((intervalTarget) => {
      intervalTarget.disabled = true
    })
  }

  activeProposalSwitch (e) {
    const switchCheck = document.getElementById('activeProposalInput').checked
    this.settings.active = switchCheck
    this.calculate()
  }

  nameMatrixSwitchEvent (e) {
    const switchCheck = document.getElementById('nameMonthSwitchInput').checked
    this.isMonthDisplay = switchCheck
    // if is proposals group type
    if (this.settings.pgroup === 'proposals') {
      this.settings.type = !switchCheck || switchCheck === 'false' ? 'summary' : 'proposal'
    } else {
      this.settings.ptype = !switchCheck || switchCheck === 'false' ? 'list' : 'month'
    }
    this.calculate()
  }

  useMonthAvgSwitch (e) {
    const switchCheck = document.getElementById('useMonthAvg').checked
    this.useMonthAvg = switchCheck
    // if is not Treasury or domain type, do not anything
    if (!this.isTreasuryReport() && !this.isDomainType()) {
      return
    }
    this.settings.tavg = this.useMonthAvg
    this.calculate()
  }

  proposalReportTimeDetail (e) {
    const idArr = e.target.id.split(';')
    if (idArr.length !== 2) {
      return
    }
    window.location.href = '/finance-report/detail?type=' + idArr[0] + '&time=' + idArr[1].replace('/', '_')
  }

  showNoData () {
    this.noDetailDataTarget.classList.remove('d-none')
    this.reportAreaTarget.classList.add('d-none')
  }

  prevReport (e) {
    const timeIntArr = this.getDetailYearMonth()
    if (this.isYearDetailReport()) {
      if (timeIntArr[0] === this.reportMinYear) {
        return
      }
      this.settings.dtime = (timeIntArr[0] - 1).toString()
    } else if (this.isMonthDetailReport()) {
      let year = timeIntArr[0]
      let month = timeIntArr[1]
      if (year === this.reportMinYear && month === this.reportMinMonth) {
        return
      }
      if (month === 1) {
        year = year - 1
        month = 12
      } else {
        month = month - 1
      }
      this.settings.dtime = year + '_' + month
    }
    this.initReportDetailData()
  }

  nextReport (e) {
    const timeIntArr = this.getDetailYearMonth()
    if (this.isYearDetailReport()) {
      if (timeIntArr[0] === this.reportMaxYear) {
        return
      }
      this.settings.dtime = (timeIntArr[0] + 1).toString()
    } else if (this.isMonthDetailReport()) {
      let year = timeIntArr[0]
      let month = timeIntArr[1]
      if (year === this.reportMaxYear && month === this.reportMaxMonth) {
        return
      }
      if (month === 12) {
        year = year + 1
        month = 1
      } else {
        month = month + 1
      }
      this.settings.dtime = year + '_' + month
    }
    this.initReportDetailData()
  }

  proposalDetailsListUpdate () {
    if (this.settings.dtype === 'domain' || this.settings.dtype === 'owner') {
      this.summaryReportTarget.innerHTML = this.createDetailSummaryTable(responseDetailData.proposalInfos, this.settings.dtype === 'owner', this.settings.dtype === 'domain')
    } else if (this.settings.dtype === 'proposal') {
      this.otherProposalSummaryTarget.innerHTML = this.createDetailSummaryTable(responseDetailData.otherProposalInfos, true, false)
    }
  }

  yearMonthProposalListUpdate () {
    this.proposalReportTarget.innerHTML = this.createProposalDetailReport(responseDetailData)
  }

  setDomainGeneralInfo (data, type) {
    this.proposalSumCardTarget.classList.remove('d-none')
    let totalBudget = 0; let totalSpent = 0; let totalRemaining = 0
    if (data.proposalInfos && data.proposalInfos.length > 0) {
      data.proposalInfos.forEach((proposal) => {
        totalBudget += proposal.budget
        totalSpent += proposal.totalSpent
        totalRemaining += proposal.totalRemaining > 0 ? proposal.totalRemaining : 0
      })
    }
    this.proposalSpanRowTarget.innerHTML = `<p>Total Budget: <span class="fw-600">$${humanize.formatToLocalString(totalBudget, 2, 2)}</span></p>` +
    `<p>Total ${type === 'owner' ? 'Received' : 'Spent'} (Estimate):<span class="fw-600">$${humanize.formatToLocalString(totalSpent, 2, 2)}</span></p>` +
    `<p>Total Remaining (Estimate): <span class="fw-600">$${humanize.formatToLocalString(totalRemaining, 2, 2)}</span></p>`
  }

  createDetailSummaryTable (data, hideAuthor, hideDomain) {
    if (!data) {
      return ''
    }
    let thead = '<thead>' +
      '<tr class="text-secondary finance-table-header">' +
      '<th class="va-mid text-center month-col fs-13i fw-600 proposal-name-col">Name</th>'
    if (!hideDomain) {
      thead += '<th class="va-mid text-center fs-13i px-2 fw-600">Domain</th>'
    }
    if (!hideAuthor) {
      thead += '<th class="va-mid text-center fs-13i px-2 fw-600">Author</th>'
    }
    thead += '<th class="va-mid text-center px-2 fs-13i fw-600"><label class="cursor-pointer" data-action="click->financereport#sortDetailByStartDate">Start Date</label>' +
      `<span data-action="click->financereport#sortDetailByStartDate" class="${(this.settings.dstype === 'startdt' && this.settings.dorder === 'desc') ? 'dcricon-arrow-down' : 'dcricon-arrow-up'} ${(!this.settings.dstype || this.settings.dstype === '' || this.settings.dstype === 'startdt') ? '' : 'c-grey-4'} col-sort ms-1"></span></th>` +
      '<th class="va-mid text-center px-2 fs-13i fw-600">End Date</th>' +
      '<th class="va-mid text-right px-2 fs-13i fw-600"><label class="cursor-pointer" data-action="click->financereport#sortDetailByBudget">Budget</label>' +
      `<span data-action="click->financereport#sortDetailByBudget" class="${(this.settings.dstype === 'budget' && this.settings.dorder === 'desc') ? 'dcricon-arrow-down' : 'dcricon-arrow-up'} ${this.settings.dstype !== 'budget' ? 'c-grey-4' : ''} col-sort ms-1"></span></th>` +
      '<th class="va-mid text-right px-2 fs-13i fw-600">Days</th>' +
      '<th class="va-mid text-right px-2 fs-13i fw-600">Monthly Avg (Est)</th>' +
      '<th class="va-mid text-right px-2 fs-13i fw-600">Total Spent (Est)</th>' +
      '<th class="va-mid text-right px-2 fs-13i fw-600">Total Remaining (Est)</th></tr></thead>'
    let tbody = '<tbody>###</tbody>'
    let bodyList = ''
    let totalBudget = 0
    let totalAllSpent = 0
    let totalRemaining = 0
    // create tbody content
    const summaryList = this.sortDetailSummary(data)
    for (let i = 0; i < summaryList.length; i++) {
      const summary = summaryList[i]
      const lengthInDays = this.getLengthInDay(summary)
      let monthlyAverage = summary.budget / lengthInDays
      if (lengthInDays < 30) {
        monthlyAverage = summary.budget
      } else {
        monthlyAverage = monthlyAverage * 30
      }
      totalBudget += summary.budget
      totalAllSpent += summary.totalSpent
      totalRemaining += summary.totalRemaining > 0 ? summary.totalRemaining : 0
      bodyList += `<tr class="${summary.totalRemaining === 0.0 ? 'proposal-summary-row' : 'summary-active-row'}">` +
        `<td class="va-mid text-center fs-13i"><a href="${'/finance-report/detail?type=proposal&token=' + summary.token}" class="link-hover-underline fs-13i" data-turbolinks="false">${summary.name}</a></td>`
      if (!hideAuthor) {
        bodyList += `<td class="va-mid text-center fs-13i"><a href="${'/finance-report/detail?type=owner&name=' + summary.author}" data-turbolinks="false" class="link-hover-underline fs-13i">${summary.author}</a></td>`
      }
      if (!hideDomain) {
        bodyList += `<td class="va-mid text-center fs-13i"><a href="${'/finance-report/detail?type=domain&name=' + summary.domain}" data-turbolinks="false" class="link-hover-underline fs-13i">${summary.domain.charAt(0).toUpperCase() + summary.domain.slice(1)}</a></td>`
      }
      bodyList += `<td class="va-mid text-center fs-13i">${summary.start}</td>` +
        `<td class="va-mid text-center fs-13i">${summary.end}</td>` +
        `<td class="va-mid text-right px-2 fs-13i">$${humanize.formatToLocalString(summary.budget, 2, 2)}</td>` +
        `<td class="va-mid text-right fs-13i">${lengthInDays}</td>` +
        `<td class="va-mid text-right px-2 fs-13i">$${humanize.formatToLocalString(monthlyAverage, 2, 2)}</td>` +
        `<td class="va-mid text-right px-2 fs-13i">${summary.totalSpent > 0 ? '$' + humanize.formatToLocalString(summary.totalSpent, 2, 2) : ''}</td>` +
        `<td class="va-mid text-right px-2 fs-13i">${summary.totalRemaining > 0 ? '$' + humanize.formatToLocalString(summary.totalRemaining, 2, 2) : ''}</td>` +
        '</tr>'
    }
    const totalColSpan = hideAuthor && hideDomain ? '3' : ((!hideAuthor && hideDomain) || (hideAuthor && !hideDomain) ? '4' : '5')
    bodyList += '<tr class="text-secondary finance-table-header finance-table-footer last-row-header">' +
    `<td class="va-mid text-center fw-600 fs-13i" colspan="${totalColSpan}">Total</td>` +
    `<td class="va-mid text-right px-2 fw-600 fs-13i">$${humanize.formatToLocalString(totalBudget, 2, 2)}</td>` +
    '<td></td><td></td>' +
    `<td class="va-mid text-right px-2 fw-600 fs-13i">$${humanize.formatToLocalString(totalAllSpent, 2, 2)}</td>` +
    `<td class="va-mid text-right px-2 fw-600 fs-13i">$${humanize.formatToLocalString(totalRemaining, 2, 2)}</td>` +
    '</tr>'
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

  createMonthYearTable (data, type) {
    let handlerData = data.monthData
    if (type === 'year') {
      handlerData = this.getYearDataFromMonthData(data)
    }
    let breakTable = 7
    if (type === 'year' || this.settings.dtype === 'proposal') {
      // No break
      breakTable = 50
    }
    return this.createTableDetailForMonthYear(handlerData, breakTable, type)
  }

  createTableDetailForMonthYear (handlerData, breakTable, type) {
    let allTable = ''
    let count = 0
    let stepNum = 0
    for (let i = 0; i < handlerData.length; i++) {
      if (count === 0) {
        allTable += `<table class="table monthly v3 border-grey-2 w-auto ${stepNum > 0 ? 'ms-2' : ''}" style="height: 40px;">` +
        '<col><colgroup span="2"></colgroup><thead>' +
        `<tr class="text-secondary finance-table-header"><th rowspan="2" class="va-mid text-center px-2 fs-13i fw-600">${type === 'year' ? 'Year' : 'Month'}</th>` +
        '<th colspan="2" scope="colgroup" class="va-mid text-center-i fs-13i fw-600">Spent (Est)</th>'
        allTable += (this.settings.dtype === 'year' ? '<th colspan="2" scope="colgroup" class="va-mid text-center-i fs-13i fw-600">Actual Spent</th>' : '') + '</tr>'
        allTable += '<tr class="text-secondary finance-table-header">' +
        '<th scope="col" class="va-mid text-center-i fs-13i fw-600">USD</th>' +
        '<th scope="col" class="va-mid text-center-i fs-13i fw-600">DCR</th>'
        allTable += this.settings.dtype === 'year' ? '<th scope="col" class="va-mid text-center-i fs-13i fw-600">USD</th><th scope="col" class="va-mid text-center-i fs-13i fw-600">DCR</th>' : ''
        allTable += '</tr></thead><tbody>'
      }
      const dataMonth = handlerData[i]
      let isFuture = false
      const timeYearMonth = this.getYearMonthArray(dataMonth.month, '-')
      const nowDate = new Date()
      const year = nowDate.getUTCFullYear()
      const month = nowDate.getUTCMonth() + 1
      if (type === 'year') {
        isFuture = timeYearMonth[0] > year
      } else if (type === 'month') {
        const compareDataTime = timeYearMonth[0] * 12 + timeYearMonth[1]
        const compareNowTime = year * 12 + month
        isFuture = compareDataTime > compareNowTime
      }
      allTable += `<tr class="odd-even-row ${isFuture ? 'future-row-data' : ''}">`
      const timeParam = this.getFullTimeParam(dataMonth.month, '-')
      allTable += `<td class="text-left px-2 fs-13i"><a class="link-hover-underline fs-13i fw-600" style="text-align: right; width: 80px;" data-turbolinks="false" href="${'/finance-report/detail?type=' + type + '&time=' + (timeParam === '' ? dataMonth.month : timeParam)}">${dataMonth.month}</a></td>`
      allTable += `<td class="text-right px-2 fs-13i">${dataMonth.expense !== 0.0 ? '$' + humanize.formatToLocalString(dataMonth.expense, 2, 2) : '-'}</td>` +
                  `<td class="text-right px-2 fs-13i">${dataMonth.expenseDcr !== 0.0 ? humanize.formatToLocalString(dataMonth.expenseDcr / 1e8, 2, 2) : '-'}</td>`
      if (this.settings.dtype === 'year') {
        allTable += `<td class="text-right px-2 fs-13i">${dataMonth.actualExpense !== 0.0 ? '$' + humanize.formatToLocalString(dataMonth.actualExpense, 2, 2) : '-'}</td>` +
                    `<td class="text-right px-2 fs-13i">${dataMonth.actualExpenseDcr !== 0.0 ? humanize.formatToLocalString(dataMonth.actualExpenseDcr / 1e8, 2, 2) : '-'}</td>`
      }
      allTable += '</tr>'
      if (count === breakTable) {
        allTable += '</tbody>'
        allTable += '</table>'
        count = 0
      } else {
        count++
      }
      stepNum++
    }
    if (count !== breakTable) {
      allTable += '</tbody>'
      allTable += '</table>'
    }
    return allTable
  }

  // Calculate and response
  async yearMonthCalculate () {
    this.pageLoaderTarget.classList.add('loading')
    // set up navigative to main report and up level of time
    // this.toUpReportTarget.href = '/finance-report'
    const url = `/api/finance-report/detail?type=${this.settings.dtype}&time=${this.settings.dtime}`
    let response
    requestDetailCounter++
    const thisRequest = requestDetailCounter
    if (hasDetailCache(url)) {
      response = responseDetailCache[url]
    } else {
      // response = await axios.get(url)
      response = await requestJSON(url)
      responseDetailCache[url] = response
      if (thisRequest !== requestDetailCounter) {
        // new request was issued while waiting.
        console.log('Response request different')
      }
    }

    if (!response) {
      this.proposalAreaTarget.classList.add('d-none')
      this.pageLoaderTarget.classList.remove('loading')
      return
    }
    responseDetailData = response
    this.proposalReportTarget.innerHTML = this.createProposalDetailReport(response)
    if (response.proposalTotal > 0) {
      this.proposalTopSummaryTarget.classList.remove('d-none')
      this.handlerSummaryArea(response)
      this.createDomainsSummaryTable(response)
    } else {
      this.proposalTopSummaryTarget.classList.add('d-none')
    }
    this.createYearMonthTopSummary(response)
    // create month data list if type is year
    if (this.settings.dtype === 'year') {
      if (response.monthlyResultData && response.monthlyResultData.length > 0) {
        this.monthlyAreaTarget.classList.remove('d-none')
        this.monthlyReportTarget.innerHTML = this.createTableDetailForMonthYear(response.monthlyResultData, 12, 'month')
      } else {
        this.monthlyAreaTarget.classList.add('d-none')
      }
    } else {
      this.monthlyAreaTarget.classList.add('d-none')
    }
    this.pageLoaderTarget.classList.remove('loading')
  }

  handlerSummaryArea (data) {
    this.expendiduteValueTarget.textContent = '$' + humanize.formatToLocalString(data.proposalTotal, 2, 2)
    // display proposal spent value
    if (!data.reportDetail || data.reportDetail.length === 0) {
      return
    }
    let totalSpent = 0
    let totalSpentDCR = 0
    for (let i = 0; i < data.reportDetail.length; i++) {
      const report = data.reportDetail[i]
      totalSpent += report.spentEst > 0 ? report.spentEst : 0
      totalSpentDCR += report.totalSpentDcr > 0 ? report.totalSpentDcr : 0
    }
    if (totalSpent > 0) {
      this.proposalSpentAreaTarget.classList.remove('d-none')
      this.proposalSpentTarget.textContent = '$' + humanize.formatToLocalString(totalSpent, 2, 2) + ` (${humanize.formatToLocalString(totalSpentDCR, 2, 2)} DCR)`
    } else {
      this.proposalSpentAreaTarget.classList.add('d-none')
    }
    // display treasury spent value
    if (totalSpent > 0) {
      this.treasurySpentAreaTarget.classList.remove('d-none')
      this.unaccountedValueAreaTarget.classList.remove('d-none')
      const combinedUSD = data.treasurySummary.outvalueUSD + data.legacySummary.outvalueUSD
      const combinedDCR = data.treasurySummary.outvalue + data.legacySummary.outvalue
      this.treasurySpentTarget.textContent = '$' + humanize.formatToLocalString(combinedUSD, 2, 2) + ` (${humanize.formatToLocalString(combinedDCR / 100000000, 2, 2)} DCR)`
      const deltaUSD = combinedUSD - totalSpent
      const deltaDCR = combinedDCR / 100000000 - totalSpentDCR
      this.unaccountedValueTarget.textContent = (deltaUSD < 0 ? '-' : '') + '$' + humanize.formatToLocalString(Math.abs(deltaUSD), 2, 2) + ` (${humanize.formatToLocalString(deltaDCR, 2, 2)} DCR, ${deltaUSD < 0 ? 'Missing' : 'Unaccounted'})`
    } else {
      this.treasurySpentAreaTarget.classList.add('d-none')
      this.unaccountedValueAreaTarget.classList.add('d-none')
    }
  }

  createDomainDetailReport (data) {
    if (!data.reportDetail || data.reportDetail.length === 0) {
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
    let tbody = '<tbody>###</tbody>'

    let bodyList = ''
    for (let i = 0; i < data.domainList.length; i++) {
      const domain = data.domainList[i]
      bodyList += '<tr>'
      // td domain name
      bodyList += `<td class="text-left fs-13i"><a href="${'/finance-report/detail?type=domain&name=' + domain}" data-turbolinks="false" class="link-hover-underline fs-13i">${domain.charAt(0).toUpperCase() + domain.slice(1)}</a></td>`
      bodyList += `<td class="text-right fs-13i">$${humanize.formatToLocalString(domainMap.get(domain), 2, 2)}</td>`
      bodyList += '</tr>'
    }
    tbody = tbody.replace('###', bodyList)
    return tbody
  }

  createYearMonthTopSummary (data) {
    if (data.treasurySummary.invalue <= 0 && data.treasurySummary.outvalue <= 0 && data.legacySummary.invalue <= 0 && data.legacySummary.outvalue <= 0) {
      this.totalSpanRowTarget.classList.add('d-none')
      return
    }
    this.totalSpanRowTarget.classList.remove('d-none')
    let innerHtml = '<col><colgroup span="2"></colgroup>' +
    '<thead><tr class="text-secondary finance-table-header"><th rowspan="2" class="va-mid text-center px-2 fs-13i fw-600">Treasury Type</th>' +
    '<th colspan="2" scope="colgroup" class="va-mid text-center-i fs-13i fw-600">Value</th></tr>' +
    '<tr class="text-secondary finance-table-header"><th scope="col" class="va-mid text-center-i fs-13i fw-600">DCR</th>' +
    '<th scope="col" class="va-mid text-center-i fs-13i fw-600">USD</th></tr></thead><tbody>'
    innerHtml += data.treasurySummary.invalue > 0
      ? `<tr class="odd-even-row"><td class="text-left px-2 fs-13i">Decentralized Income</td><td class="text-right px-2 fs-13i">${humanize.formatToLocalString((data.treasurySummary.invalue / 100000000), 3, 3) + ' DCR'}</td>` +
    `<td class="text-right px-2 fs-13i">$${humanize.formatToLocalString((data.treasurySummary.invalueUSD), 2, 2)}</td></tr>`
      : ''
    innerHtml += data.treasurySummary.outvalue > 0
      ? `<tr class="odd-even-row"><td class="text-left px-2 fs-13i">Decentralized Outgoing</td><td class="text-right px-2 fs-13i">${humanize.formatToLocalString((data.treasurySummary.outvalue / 100000000), 3, 3) + ' DCR'}</td>` +
    `<td class="text-right px-2 fs-13i">$${humanize.formatToLocalString((data.treasurySummary.outvalueUSD), 2, 2)}</td></tr>`
      : ''
    innerHtml += data.legacySummary.invalue > 0
      ? `<tr class="odd-even-row"><td class="text-left px-2 fs-13i">Admin Income</td><td class="text-right px-2 fs-13i">${humanize.formatToLocalString((data.legacySummary.invalue / 100000000), 3, 3) + ' DCR'}</td>` +
    `<td class="text-right px-2 fs-13i">$${humanize.formatToLocalString((data.legacySummary.invalueUSD), 2, 2)}</td></tr>`
      : ''
    innerHtml += data.legacySummary.outvalue > 0
      ? `<tr class="odd-even-row"><td class="text-left px-2 fs-13i">Admin Outgoing</td><td class="text-right px-2 fs-13i">${humanize.formatToLocalString((data.legacySummary.outvalue / 100000000), 3, 3) + ' DCR'}</td>` +
    `<td class="text-right px-2 fs-13i">$${humanize.formatToLocalString((data.legacySummary.outvalueUSD), 2, 2)}</td></tr>`
      : ''
    innerHtml += '</tbody>'
    this.yearMonthInfoTableTarget.innerHTML = innerHtml
  }

  createDomainsSummaryTable (data) {
    const domainDataMap = this.getDomainsSummaryData(data)
    let innerHtml = '<col><colgroup span="2"></colgroup>' +
    '<thead><tr class="text-secondary finance-table-header"><th rowspan="2" class="va-mid text-center px-2 fs-13i fw-600">Domain</th>' +
    '<th colspan="2" scope="colgroup" class="va-mid text-center-i fs-13i fw-600">Spent (Est)</th></tr>' +
    '<tr class="text-secondary finance-table-header"><th scope="col" class="va-mid text-center-i fs-13i fw-600">DCR</th>' +
    '<th scope="col" class="va-mid text-center-i fs-13i fw-600">USD</th></tr></thead><tbody>'
    let totalDCR = 0; let totalUSD = 0
    let hasData = false
    domainDataMap.forEach((val, key) => {
      if (val.valueDCR !== 0 || val.valueUSD !== 0) {
        const valueDCR = val.valueDCR
        totalDCR += val.valueDCR
        const valueUSD = val.valueUSD
        totalUSD += val.valueUSD
        hasData = true
        innerHtml += `<tr class="odd-even-row"><td class="text-left px-2 fs-13i"><a href="/finance-report/detail?type=domain&name=${key}" data-turbolinks="false" class="link-hover-underline fs-13i">${key.charAt(0).toUpperCase() + key.slice(1)}</a></td>` +
                     `<td class="text-right px-2 fs-13i">${valueDCR > 0 ? humanize.formatToLocalString(valueDCR, 2, 2) : '-'}</td>` +
                     `<td class="text-right px-2 fs-13i">$${valueUSD > 0 ? humanize.formatToLocalString(valueUSD, 2, 2) : '-'}</td></tr>`
      }
    })
    if (!hasData) {
      this.domainSummaryAreaTarget.classList.add('d-none')
      return
    }
    this.domainSummaryAreaTarget.classList.remove('d-none')
    innerHtml += '<tr class="finance-table-header finance-table-footer last-row-header">' +
      '<td class="va-mid text-center fw-600 fs-13i">Total</td>' +
      `<td class="va-mid text-right px-2 fw-600 fs-13i">${totalDCR > 0 ? humanize.formatToLocalString(totalDCR, 2, 2) : '-'}</td>` +
      `<td class="va-mid text-right px-2 fw-600 fs-13i">${totalUSD > 0 ? '$' + humanize.formatToLocalString(totalUSD, 2, 2) : '-'}</td>` +
      '</tr>'
    innerHtml += '</tbody>'
    this.domainSummaryTableTarget.innerHTML = innerHtml
  }

  getDomainsSummaryData (data) {
    const result = new Map()
    if (!data.reportDetail || data.reportDetail.length === 0) {
      return result
    }
    for (let i = 0; i < data.reportDetail.length; i++) {
      const report = data.reportDetail[i]
      const domain = report.domain
      if (result.has(domain)) {
        const detailData = {}
        const existData = result.get(domain)
        detailData.valueDCR = existData.valueDCR + (report.totalSpentDcr > 0 ? report.totalSpentDcr : 0)
        detailData.valueUSD = existData.valueUSD + (report.spentEst > 0 ? report.spentEst : 0)
        result.set(domain, detailData)
      } else {
        const detailData = {}
        detailData.valueDCR = report.totalSpentDcr > 0 ? report.totalSpentDcr : 0
        detailData.valueUSD = report.spentEst > 0 ? report.spentEst : 0
        result.set(domain, detailData)
      }
    }
    return result
  }

  sortDetailByPName () {
    this.proposalDetailSort('pname')
  }

  sortDetailByAuthor () {
    this.proposalDetailSort('author')
  }

  sortDetailByDomain () {
    this.proposalDetailSort('domain')
  }

  sortDetailByStartDate () {
    this.proposalDetailSort('startdt')
  }

  sortDetailByEndDate () {
    this.proposalDetailSort('enddt')
  }

  sortDetailBySpent () {
    this.proposalDetailSort('spent')
  }

  sortDetailByBudget () {
    this.proposalDetailSort('budget')
  }

  sortDetailByDays () {
    this.proposalDetailSort('days')
  }

  sortDetailByAvg () {
    this.proposalDetailSort('avg')
  }

  sortDetailByRemaining () {
    this.proposalDetailSort('remaining')
  }

  proposalDetailSort (type) {
    this.settings.dstype = type
    this.settings.dorder = this.settings.dorder === 'esc' ? 'desc' : 'esc'
    if (this.settings.dtype === 'year' || this.settings.dtype === 'month') {
      this.yearMonthProposalListUpdate()
    } else {
      this.proposalDetailsListUpdate()
    }
  }

  createProposalDetailReport (data) {
    if (!data.reportDetail || data.reportDetail.length === 0) {
      this.proposalAreaTarget.classList.add('d-none')
      return ''
    }

    if (!this.settings.dstype || this.settings.dstype === '') {
      this.settings.dstype = 'pname'
    }

    this.proposalAreaTarget.classList.remove('d-none')
    const thead = '<thead>' +
    '<tr class="text-secondary finance-table-header">' +
    '<th class="va-mid text-center px-2 fs-13i fw-600">Proposal Name</th>' +
    '<th class="va-mid text-center px-2 fs-13i fw-600">Domain</th>' +
    `<th class="va-mid text-right px-2 fs-13i fw-600"><label class="cursor-pointer" data-action="click->financereport#sortDetailBySpent">This ${this.settings.dtype === 'year' ? 'Year' : 'Month'} (Est)</label>` +
    `<span data-action="click->financereport#sortDetailBySpent" class="${(this.settings.dstype === 'spent' && this.settings.dorder === 'desc') ? 'dcricon-arrow-down' : 'dcricon-arrow-up'} ${this.settings.dstype !== 'spent' ? 'c-grey-4' : ''} col-sort ms-1"></span></th>` +
    '</tr></thead>'

    let tbody = '<tbody>###</tbody>'
    let bodyList = ''
    let totalExpense = 0
    // sort by startdt
    const summaryList = this.sortDetailSummary(data.reportDetail)
    for (let i = 0; i < summaryList.length; i++) {
      bodyList += '<tr class="odd-even-row">'
      const report = summaryList[i]
      // add proposal name
      bodyList += '<td class="va-mid px-2 text-left fs-13i">' +
      `<a href="${'/finance-report/detail?type=proposal&token=' + report.token}" data-turbolinks="false" class="link-hover-underline fs-13i d-block">${report.name}</a></td>` +
      `<td class="va-mid text-center px-2 fs-13i"><a href="${'/finance-report/detail?type=domain&name=' + report.domain}" data-turbolinks="false" class="link-hover-underline fs-13i">${report.domain.charAt(0).toUpperCase() + report.domain.slice(1)}</a></td>` +
        '<td class="va-mid text-right px-2 fs-13i">' +
        `${report.totalSpent > 0 ? '$' + humanize.formatToLocalString(report.totalSpent, 2, 2) : ''}</td></tr>`
      totalExpense += report.totalSpent
    }

    bodyList += '<tr class="finance-table-header finance-table-footer last-row-header">' +
    '<td class="va-mid text-center fw-600 fs-13i" colspan="2">Total</td>' +
    `<td class="va-mid text-right px-2 fw-600 fs-13i">${totalExpense > 0 ? '$' + humanize.formatToLocalString(totalExpense, 2, 2) : ''}</td>` +
    '</tr>'
    tbody = tbody.replace('###', bodyList)
    return thead + tbody
  }

  sortDetailSummary (summary) {
    if (!summary || summary.length === 0) {
      return
    }
    const _this = this
    if (this.settings.dstype === 'domain') {
      return this.sortDetailSummaryByDomain(summary)
    }
    summary.sort(function (a, b) {
      let aData = null
      let bData = null
      let alength
      let blength
      switch (_this.settings.dstype) {
        case 'pname':
          aData = a.name
          bData = b.name
          break
        case 'author':
          aData = a.author
          bData = b.author
          break
        case 'budget':
          aData = a.budget
          bData = b.budget
          break
        case 'spent':
          aData = a.totalSpent
          bData = b.totalSpent
          break
        case 'remaining':
          aData = a.totalRemaining
          bData = b.totalRemaining
          break
        case 'days':
          aData = _this.getLengthInDay(a)
          bData = _this.getLengthInDay(b)
          break
        case 'avg':
          alength = _this.getLengthInDay(a)
          blength = _this.getLengthInDay(b)
          aData = (a.budget / alength) * 30
          bData = (b.budget / blength) * 30
          break
        case 'enddt':
          aData = Date.parse(a.end)
          bData = Date.parse(b.end)
          break
        default:
          aData = Date.parse(a.start)
          bData = Date.parse(b.start)
          break
      }

      if (aData > bData) {
        return _this.settings.dorder === 'desc' ? -1 : 1
      }
      if (aData < bData) {
        return _this.settings.dorder === 'desc' ? 1 : -1
      }
      return 0
    })

    return summary
  }

  sortDetailSummaryByDomain (summary) {
    if (!summary) {
      return
    }
    const _this = this
    summary.sort(function (a, b) {
      if (a.domain > b.domain) {
        return _this.settings.dorder === 'desc' ? -1 : 1
      } else if (a.domain < b.domain) {
        return _this.settings.dorder === 'desc' ? 1 : -1
      } else {
        if (a.name > b.name) {
          return _this.settings.dorder === 'desc' ? -1 : 1
        }
        if (a.name < b.name) {
          return _this.settings.dorder === 'desc' ? 1 : -1
        }
      }
      return 0
    })

    return summary
  }

  getDetailYearMonthArray (timeInput, splitChar) {
    const timeArr = timeInput.split(splitChar)
    const result = []
    if (timeArr.length < 2) {
      result.push(parseInt(timeArr[0]))
      return result
    }
    result.push(parseInt(timeArr[0]))
    result.push(parseInt(timeArr[1]))
    return result
  }

  isYearDetailReport () {
    return this.settings.dtype === '' || this.settings.dtype === 'year'
  }

  isMonthDetailReport () {
    return this.settings.dtype === 'month'
  }

  getDetailYearMonth () {
    if (!this.settings.dtime || this.settings.dtime === '') {
      return []
    }
    const timeArr = this.settings.dtime.toString().split('_')
    const res = []
    res.push(Number(timeArr[0]))
    if (timeArr.length > 1) {
      res.push(Number(timeArr[1]))
    }
    return res
  }

  isNullValue (value) {
    return value === null || value === undefined || (typeof value === 'string' && value === '')
  }

  get chartType () {
    if (this.isDomainType()) {
      return 'amountflow'
    }
    return this.optionsTarget.value
  }

  get activeZoomDuration () {
    return this.activeZoomKey ? Zoom.mapValue(this.activeZoomKey) : false
  }

  get activeZoomKey () {
    const activeButtons = this.zoomTarget.getElementsByClassName('btn-selected')
    if (activeButtons.length === 0) return null
    return activeButtons[0].name
  }

  get chartDuration () {
    return this.xRange[1] - this.xRange[0]
  }

  get activeBin () {
    return this.cintervalTarget.getElementsByClassName('btn-selected')[0].name
  }

  get flow () {
    let base10 = 0
    this.flowBoxes.forEach((box) => {
      if (box.checked) base10 += parseInt(box.value)
    })
    return base10
  }
}
