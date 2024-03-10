import { Controller } from '@hotwired/stimulus'
import TurboQuery from '../helpers/turbolinks_helper'
import { requestJSON } from '../helpers/http'
import humanize from '../helpers/humanize_helper'
import { isEmpty } from 'lodash-es'
import { getDefault } from '../helpers/module_helper'
import { padPoints, sizedBarPlotter } from '../helpers/chart_helper'
import Zoom from '../helpers/zoom_helper'

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

const proposalNote = '*The data is the daily cost estimate based on the total budget divided by the total number of proposals days.'
let treasuryNote = ''

const proposalTitle = 'Proposals'
const domainTitle = 'Domains'
const treasuryTitle = 'Treasury Spending'
const authorTitle = 'Authors'

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

export default class extends Controller {
  static get targets () {
    return ['report', 'colorNoteRow', 'colorLabel', 'colorDescription',
      'interval', 'groupBy', 'searchInput', 'searchBtn', 'clearSearchBtn', 'searchBox', 'nodata',
      'treasuryToggleArea', 'treasuryTitle', 'reportDescription', 'reportAllPage',
      'activeProposalSwitchArea', 'options', 'flow', 'zoom', 'cinterval', 'chartbox', 'noconfirms',
      'chart', 'chartLoader', 'expando', 'littlechart', 'bigchart', 'fullscreen', 'treasuryChart', 'treasuryChartTitle',
      'yearSelect', 'ttype', 'yearSelectTitle', 'treasuryTypeTitle', 'groupByLabel', 'typeLabel', 'typeSelector',
      'bcname', 'amountFlowOption', 'balanceOption', 'chartHeader', 'outgoingExp', 'nameMatrixSwitch',
      'weekZoomBtn', 'dayZoomBtn', 'weekGroupBtn', 'dayGroupBtn', 'blockGroupBtn', 'sentRadioLabel', 'receivedRadioLabel', 'netSelectRadio']
  }

  async connect () {
    ctrl = this
    ctrl.retrievedData = {}
    ctrl.ajaxing = false
    ctrl.requestedChart = false
    // Bind functions that are passed as callbacks
    ctrl.zoomCallback = ctrl._zoomCallback.bind(ctrl)
    ctrl.drawCallback = ctrl._drawCallback.bind(ctrl)
    ctrl.lastEnd = 0
    ctrl.bindElements()
    // These two are templates for query parameter sets.
    // When url query parameters are set, these will also be updated.
    ctrl.state = Object.assign({}, ctrl.settings)

    // Parse stimulus data
    const cdata = ctrl.data
    ctrl.dcrAddress = cdata.get('dcraddress')
    ctrl.balance = cdata.get('balance')

    // Get initial view settings from the url
    ctrl.setChartType()
    if (ctrl.settings.flow) {
      ctrl.setFlowChecks()
    } else {
      ctrl.settings.flow = ctrl.defaultSettings.flow
      ctrl.setFlowChecks()
    }
    if (ctrl.settings.zoom !== null) {
      ctrl.zoomButtons.forEach((button) => {
        button.classList.remove('btn-selected')
      })
    }
    if (ctrl.settings.bin == null) {
      ctrl.settings.bin = ctrl.getBin()
    }
    if (ctrl.settings.chart == null || !ctrl.validChartType(ctrl.settings.chart)) {
      ctrl.settings.chart = ctrl.chartType
    }

    Dygraph = await getDefault(
      import('../vendor/dygraphs.min.js')
    )
    ctrl.currentTType = ctrl.settings.ttype
    ctrl.changedTType = null
    this.calculate(true)
  }

  _drawCallback (graph, first) {
    if (first) return
    const [start, end] = ctrl.graph.xAxisRange()
    if (start === end) return
    if (end === this.lastEnd) return // Only handle slide event.
    this.lastEnd = end
    ctrl.settings.zoom = Zoom.encode(start, end)
    ctrl.updateQueryString()
    ctrl.setSelectedZoom(Zoom.mapKey(ctrl.settings.zoom, ctrl.graph.xAxisExtremes()))
  }

  _zoomCallback (start, end) {
    ctrl.zoomButtons.forEach((button) => {
      button.classList.remove('btn-selected')
    })
    ctrl.settings.zoom = Zoom.encode(start, end)
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
    if (this.settings.type === 'domain' || (!ctrl.currentTType && ctrl.currentTType === ctrl.changedTType)) {
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
      if (this.settings.type !== 'domain' && this.settings.ttype === 'legacy') {
        url = '/api/address/' + ctrl.devAddress + '/amountflow/' + bin
      }
      graphDataResponse = this.settings.type === 'domain' ? (bin === 'year' ? domainChartYearData : domainChartData) : (this.settings.ttype !== 'current' && this.settings.ttype !== 'legacy') ? (bin === 'year' ? combinedChartYearData : combinedChartData) : await requestJSON(url)
    }
    ctrl.processData(chart, bin, graphDataResponse)
    this.currentTType = this.changedTType
    ctrl.ajaxing = false
    ctrl.chartLoaderTarget.classList.remove('loading')
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
      const processed = ctrl.settings.type === 'domain' ? domainChartProcessor(data, binSize) : amountFlowProcessor(data, binSize)
      ctrl.retrievedData['amountflow-' + bin] = processed.flow
      if (ctrl.settings.type !== 'domain') {
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
        options = ctrl.settings.type === 'domain' ? domainGraphOptions : amountFlowGraphOptions
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
      'chart', 'zoom', 'bin', 'flow', 'type', 'tsort', 'psort', 'stype', 'order', 'interval', 'search', 'usd', 'active', 'year', 'ttype'
    ])

    this.defaultSettings = {
      type: 'summary',
      tsort: 'newest',
      psort: 'newest',
      stype: 'startdt',
      order: 'desc',
      interval: 'month',
      search: '',
      usd: false,
      active: 'true',
      chart: 'amountflow',
      zoom: '',
      bin: 'month',
      flow: 3,
      year: 0, // 0 when display all year
      ttype: 'combined'
    }

    this.query.update(this.settings)
    if (!this.settings.type || this.settings.type === 'proposal') {
      this.defaultSettings.tsort = 'oldest'
    }
    if (!this.settings.active) {
      this.settings.active = this.defaultSettings.active
    }
    if (this.settings.type && this.settings.type === 'treasury') {
      this.defaultSettings.stype = ''
    }
    if (this.settings.type === 'treasury' && (!this.settings.tsort || this.settings.tsort === '')) {
      this.settings.tsort = this.defaultSettings.tsort
    }
    if (!this.settings.type) {
      this.settings.type = this.defaultSettings.type
    }
    if (!this.settings.interval) {
      this.settings.interval = this.defaultSettings.interval
    }
    if (!this.settings.ttype) {
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

    if (this.settings.type !== 'proposal') {
      this.intervalTargets.forEach((intervalTarget) => {
        intervalTarget.classList.remove('btn-active')
        if (intervalTarget.name === this.settings.interval) {
          intervalTarget.classList.add('btn-active')
        }
      })
      this.ttypeTargets.forEach((ttypeTarget) => {
        ttypeTarget.classList.remove('btn-active')
        if ((ttypeTarget.name === this.settings.ttype) || (ttypeTarget.name === 'current' && !this.settings.ttype)) {
          ttypeTarget.classList.add('btn-active')
        }
      })
    }
    this.devAddress = this.data.get('devAddress')
    treasuryNote = `*All numbers are pulled from the blockchain. Includes <a href="/treasury">treasury</a> and <a href="/address/${this.devAddress}">legacy</a> data.`

    if (this.settings.type === 'proposal' || this.settings.type === 'summary') {
      const $scroller = document.getElementById('scroller')
      const $container = document.getElementById('container_body')

      const $wrapper = document.getElementById('wrapper')

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
    }
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
        this.calculate(false)
      }
      return
    }
    this.searchBtnTarget.classList.add('d-none')
    this.clearSearchBtnTarget.classList.remove('d-none')
    this.settings.search = this.searchInputTarget.value
    this.calculate(false)
  }

  clearSearch (e) {
    this.settings.search = this.defaultSettings.search
    this.searchInputTarget.value = ''
    this.searchBtnTarget.classList.remove('d-none')
    this.clearSearchBtnTarget.classList.add('d-none')
    isSearching = false
    this.calculate(false)
  }

  updateQueryString () {
    const [query, settings, defaults] = [{}, this.settings, this.defaultSettings]
    for (const k in settings) {
      if (!settings[k] || settings[k].toString() === defaults[k].toString()) continue
      query[k] = settings[k]
    }
    this.query.replace(query)
  }

  setReportTitle () {
    switch (this.settings.type) {
      case 'proposal':
        this.bcnameTarget.textContent = proposalTitle
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
        this.bcnameTarget.textContent = proposalTitle
        this.reportDescriptionTarget.innerHTML = proposalNote
        break
      case 'domain':
        this.bcnameTarget.textContent = domainTitle
        this.reportDescriptionTarget.innerHTML = proposalNote
        break
      case 'treasury':
        this.bcnameTarget.textContent = treasuryTitle
        this.reportDescriptionTarget.innerHTML = treasuryNote
        break
      case 'author':
        this.bcnameTarget.textContent = authorTitle
        this.reportDescriptionTarget.innerHTML = proposalNote
    }
  }

  treasuryTypeChange (e) {
    if (e.target.name === this.settings.ttype) {
      return
    }
    const target = e.srcElement || e.target
    this.ttypeTargets.forEach((ttypeTarget) => {
      ttypeTarget.classList.remove('btn-active')
    })
    target.classList.add('btn-active')
    this.settings.ttype = e.target.name
    this.changedTType = e.target.name
    this.calculate(true)
  }

  intervalChange (e) {
    if (e.target.name === ctrl.settings.interval) {
      return
    }
    const target = e.srcElement || e.target
    this.intervalTargets.forEach((intervalTarget) => {
      intervalTarget.classList.remove('btn-active')
    })
    target.classList.add('btn-active')
    ctrl.settings.interval = e.target.name
    if (e.target.name === 'year') {
      if (ctrl.settings.bin !== 'year') {
        ctrl.binputs.forEach((button) => {
          if (button.name === 'year') {
            button.click()
          }
        })
        ctrl.zoomButtons.forEach((button) => {
          if (button.name === 'all') {
            button.click()
          }
        })
      }
    } else {
      if (ctrl.settings.bin === 'year') {
        ctrl.binputs.forEach((button) => {
          if (button.name === 'month') {
            button.click()
          }
        })
        ctrl.zoomButtons.forEach((button) => {
          if (button.name === 'year') {
            button.click()
          }
        })
      }
    }
    this.calculate(false)
  }

  getApiUrlByType () {
    switch (this.settings.type) {
      case 'treasury':
        return '/api/finance-report/treasury'
      default:
        return `/api/finance-report/proposal?search=${!this.settings.search ? '' : this.settings.search}`
    }
  }

  createReportTable (redrawFlg) {
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
    // if summary, display toggle for filter Proposals are active
    if (this.settings.type === 'summary') {
      this.activeProposalSwitchAreaTarget.classList.remove('d-none')
      if (this.settings.active === 'false') {
        document.getElementById('activeProposalInput').checked = false
      } else {
        document.getElementById('activeProposalInput').checked = true
      }
    } else {
      this.settings.active = 'false'
      this.activeProposalSwitchAreaTarget.classList.add('d-none')
    }
    this.updateQueryString()

    if (this.settings.type === 'treasury') {
      this.treasuryTitleTarget.classList.remove('d-none')
      this.groupByLabelTarget.classList.add('ms-3')
      this.treasuryToggleAreaTarget.classList.remove('d-none')
      if (!this.settings.usd || this.settings.usd === 'false') {
        document.getElementById('usdSwitchInput').checked = false
      } else {
        document.getElementById('usdSwitchInput').checked = true
      }
      this.createTreasuryTable(responseData)
      this.treasuryChartTarget.classList.remove('d-none')
      this.treasuryChartTitleTarget.classList.remove('d-none')
      if (redrawFlg) {
        this.initializeChart()
        this.drawGraph()
        if (ctrl.zoomButtons) {
          ctrl.zoomButtons.forEach((button) => {
            if (button.name === 'year') {
              button.click()
            }
          })
        }
      }
    } else {
      this.treasuryToggleAreaTarget.classList.add('d-none')
      this.treasuryTitleTarget.classList.add('d-none')
      if (this.settings.type === 'domain') {
        this.treasuryChartTarget.classList.remove('d-none')
        this.initializeChart()
        this.drawGraph()
        // Change select option name
        this.amountFlowOptionTarget.innerHTML = 'Domain'
        // hide balance select option
        this.balanceOptionTarget.classList.add('d-none')
        // change domain on radio button label
        this.sentRadioLabelTarget.textContent = 'Development'
        this.receivedRadioLabelTarget.textContent = 'Marketing'
        // hide net radio button
        this.netSelectRadioTarget.classList.add('d-none')
        // hide some option on group and zoom
        this.weekZoomBtnTarget.classList.add('d-none')
        this.dayZoomBtnTarget.classList.add('d-none')
        this.weekGroupBtnTarget.classList.add('d-none')
        this.dayGroupBtnTarget.classList.add('d-none')
        this.blockGroupBtnTarget.classList.add('d-none')
        if (ctrl.settings.bin !== 'year') {
          if (ctrl.zoomButtons) {
            ctrl.zoomButtons.forEach((button) => {
              if (button.name === 'year') {
                button.click()
              }
            })
          }
        }
      } else {
        this.treasuryChartTarget.classList.add('d-none')
      }
      this.treasuryChartTitleTarget.classList.add('d-none')
    }

    if (this.settings.type === 'domain' || this.settings.type === 'treasury') {
      this.groupByTarget.classList.remove('d-none')
      if (this.settings.type === 'treasury') {
        this.typeLabelTarget.classList.remove('d-none')
        this.typeSelectorTarget.classList.remove('d-none')
      } else {
        this.typeLabelTarget.classList.add('d-none')
        this.typeSelectorTarget.classList.add('d-none')
      }
    } else {
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

    if (this.settings.type === 'proposal' || this.settings.type === 'summary') {
      const tableWidthStr = $('#reportTable').css('width').replace('px', '')
      console.log(tableWidthStr)
      const tableWidth = parseFloat(tableWidthStr.trim())
      console.log(tableWidth)
      $('#scrollerLong').css('width', (tableWidth + 25) + 'px')
      this.reportTarget.classList.add('proposal-table-padding')
      $('#scroller').removeClass('d-none')
      $('html').css('overflow-x', 'hidden')
    } else {
      $('html').css('overflow-x', 'auto')
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
    if (this.settings.type === 'treasury' || this.settings.type === 'domain') {
      this.settings.tsort = this.settings.tsort === 'oldest' ? 'newest' : 'oldest'
    } else {
      this.settings.tsort = (this.settings.tsort === 'oldest' || !this.settings.tsort || this.settings.tsort === '') ? 'newest' : 'oldest'
    }
    if (this.settings.type === 'treasury' || this.settings.type === 'domain') {
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
          monthObj.count += 1
          if (monthInt > monthObj.monthInt) {
            monthObj.monthInt = monthInt
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
      bodyList += `<td class="text-right fs-13i fw-600 border-left-grey report-last-data va-mid">$${humanize.formatToLocalString(handlerData.summary[index].budget, 2, 2)}</td></tr>`
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

    if (!this.settings.stype || this.settings.stype === '') {
      this.settings.stype = this.defaultSettings.stype
    }

    if (!this.settings.order || this.settings.order === '') {
      this.settings.order = this.defaultSettings.order
    }

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
      '<th class="va-mid text-center fw-600"><label class="cursor-pointer" data-action="click->financereport#sortByDays">Days</label>' +
      `<span data-action="click->financereport#sortByDays" class="${(this.settings.stype === 'days' && this.settings.order === 'desc') ? 'dcricon-arrow-down' : 'dcricon-arrow-up'} ${this.settings.stype !== 'days' ? 'c-grey-3' : ''} col-sort ms-1"></span></th>` +
      '<th class="va-mid text-center fw-600"><label class="cursor-pointer" data-action="click->financereport#sortByAvg">Monthly Avg (Est)</label>' +
      `<span data-action="click->financereport#sortByAvg" class="${(this.settings.stype === 'avg' && this.settings.order === 'desc') ? 'dcricon-arrow-down' : 'dcricon-arrow-up'} ${this.settings.stype !== 'avg' ? 'c-grey-3' : ''} col-sort ms-1"></span></th>` +
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
      if (this.settings.active === 'true' && summary.totalRemaining === 0.0) {
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
      bodyList += `<tr${summary.totalRemaining === 0.0 ? '' : ' class="summary-active-row"'}>` +
        `<td class="va-mid text-center fs-13i proposal-name-column"><a href="${'/finance-report/detail?type=proposal&token=' + token}" class="link-hover-underline fs-13i">${summary.name}</a></td>` +
        `<td class="va-mid text-center px-3 fs-13i"><a href="${'/finance-report/detail?type=domain&name=' + summary.domain}" class="link-hover-underline fs-13i">${summary.domain.charAt(0).toUpperCase() + summary.domain.slice(1)}</a></td>` +
        `<td class="va-mid text-center px-3 fs-13i"><a href="${'/finance-report/detail?type=owner&name=' + summary.author}" class="link-hover-underline fs-13i">${summary.author}</a></td>` +
        `<td class="va-mid text-center px-3 fs-13i"><label class="date-column">${summary.start}</label></td>` +
        `<td class="va-mid text-center px-3 fs-13i"><label class="date-column">${summary.end}</label></td>` +
        `<td class="va-mid text-right px-3 fs-13i">$${humanize.formatToLocalString(summary.budget, 2, 2)}</td>` +
        `<td class="va-mid text-right px-3 fs-13i">${lengthInDays}</td>` +
        `<td class="va-mid text-right px-3 fs-13i"><p class="est-column">$${humanize.formatToLocalString(monthlyAverage, 2, 2)}</p></td>` +
        `<td class="va-mid text-right px-3 fs-13i"><p class="est-column">${summary.totalSpent > 0 ? '$' + humanize.formatToLocalString(summary.totalSpent, 2, 2) : ''}</p></td>` +
        `<td class="va-mid text-right px-3 fs-13i pr-10i"><p class="remaining-est-column">${summary.totalRemaining > 0 ? '$' + humanize.formatToLocalString(summary.totalRemaining, 2, 2) : ''}</p></td>` +
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

  changeYear (e) {
    if (!e.target.value || e.target.value === '') {
      return
    }
    this.settings.year = e.target.value
    this.calculate(false)
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
        aData = a.total
        bData = b.total
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
    '<th class="va-mid text-center px-3 month-col fw-600"><label class="cursor-pointer" data-action="click->financereport#sortByAuthor">Author</label>' +
    `<span data-action="click->financereport#sortByAuthor" class="${(this.settings.stype === 'author' && this.settings.order === 'desc') ? 'dcricon-arrow-down' : 'dcricon-arrow-up'} ${this.settings.stype !== 'author' ? 'c-grey-3' : ''} col-sort ms-1"></span></th>` +
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
      bodyList += `<td class="va-mid text-right px-3 fs-13i">${author.budget > 0 ? '$' + humanize.formatToLocalString(author.budget, 2, 2) : ''}</td>`
      bodyList += `<td class="va-mid text-right px-3 fs-13i">${author.totalReceived > 0 ? '$' + humanize.formatToLocalString(author.totalReceived, 2, 2) : ''}</td>`
      bodyList += `<td class="va-mid text-right px-3 fs-13i">${author.totalRemaining > 0 ? '$' + humanize.formatToLocalString(author.totalRemaining, 2, 2) : ''}</td></tr>`
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
      handlerData = domainYearData != null ? domainYearData : this.getProposalYearlyData(data)
    }

    if (handlerData.report.length < 1) {
      this.nodataTarget.classList.remove('d-none')
      this.reportTarget.classList.add('d-none')
      return
    }
    this.nodataTarget.classList.add('d-none')
    this.reportTarget.classList.remove('d-none')

    let thead = '<thead><tr class="text-secondary finance-table-header">' +
      `<th class="va-mid text-center ps-0 month-col border-right-grey cursor-pointer" data-action="click->financereport#sortByCreateDate"><span class="${this.settings.tsort === 'oldest' ? 'dcricon-arrow-up' : 'dcricon-arrow-down'} ${this.settings.stype && this.settings.stype !== '' ? 'c-grey-3' : ''} col-sort"></span></th>` +
      '###' +
      '<th class="va-mid text-right ps-0 fw-600 month-col pe-2 border-left-grey"><label class="cursor-pointer" data-action="click->financereport#sortByDomainTotal">Total (Est)</label>' +
      `<span data-action="click->financereport#sortByDomainTotal" class="${(this.settings.stype === 'total' && this.settings.order === 'desc') ? 'dcricon-arrow-down' : 'dcricon-arrow-up'} ${this.settings.stype !== 'total' ? 'c-grey-3' : ''} col-sort ms-1"></span></th>` +
      '</tr></thead>'
    let tbody = '<tbody>###</tbody>'

    let headList = ''
    handlerData.domainList.forEach((domain) => {
      headList += `<th class="va-mid text-right-i domain-content-cell ps-0 fs-13i ps-5 pe-3 fw-600"><a href="${'/finance-report/detail?type=domain&name=' + domain}" class="link-hover-underline fs-13i">${domain.charAt(0).toUpperCase() + domain.slice(1)} (Est)</a>` +
      `<span data-action="click->financereport#sortByDomainItem" data-financereport-domain-param="${domain}" class="${(this.settings.stype === domain && this.settings.order === 'desc') ? 'dcricon-arrow-down' : 'dcricon-arrow-up'} ${this.settings.stype !== domain ? 'c-grey-3' : ''} col-sort ms-1"></span></th>`
    })
    thead = thead.replace('###', headList)

    let bodyList = ''
    const domainDataMap = new Map()
    // sort before display on table
    const domainList = this.sortDomains(handlerData.report)
    // create tbody content
    for (let i = 0; i < domainList.length; i++) {
      const report = domainList[i]
      const timeParam = this.getFullTimeParam(report.month, '/')
      bodyList += `<tr><td class="va-mid text-center fs-13i fw-600 border-right-grey"><a class="link-hover-underline fs-13i" style="text-align: right; width: 80px;" href="${'/finance-report/detail?type=' + this.settings.interval + '&time=' + (timeParam === '' ? report.month : timeParam)}">${report.month.replace('/', '-')}</a></td>`
      report.domainData.forEach((domainData) => {
        bodyList += `<td class="va-mid text-right-i domain-content-cell pe-3 fs-13i">${domainData.expense > 0 ? '$' + humanize.formatToLocalString(domainData.expense, 2, 2) : ''}</td>`
        if (domainDataMap.has(domainData.domain)) {
          domainDataMap.set(domainData.domain, domainDataMap.get(domainData.domain) + domainData.expense)
        } else {
          domainDataMap.set(domainData.domain, domainData.expense)
        }
      })
      bodyList += `<td class="va-mid text-right fs-13i fw-600 border-left-grey">$${humanize.formatToLocalString(report.total, 2, 2)}</td></tr>`
    }

    bodyList += '<tr class="finance-table-header"><td class="text-center fw-600 fs-15i border-right-grey">Total (Est)</td>'
    let totalAll = 0
    handlerData.domainList.forEach((domain) => {
      bodyList += `<td class="va-mid text-right fw-600 fs-13i domain-content-cell pe-3">$${humanize.formatToLocalString(domainDataMap.get(domain), 2, 2)}</td>`
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
    this.treasuryTypeTitleTarget.textContent = this.settings.ttype === 'legacy' ? 'Admin Treasury' : this.settings.ttype === 'combined' ? 'Combined' : 'Decentralized Treasury'
    if (this.settings.ttype !== 'legacy') {
      this.outgoingExpTarget.classList.remove('d-none')
    } else {
      this.outgoingExpTarget.classList.add('d-none')
    }
    if (!data.treasurySummary && !data.legacySummary) {
      return
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

    this.reportTarget.innerHTML = this.createTreasuryLegacyTableContent(treasuryData)
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

  getTreasuryDataWithType (data) {
    if (!this.settings.ttype || this.settings.ttype === 'current') {
      return data.treasurySummary
    }
    if (this.settings.ttype === 'legacy') {
      return data.legacySummary
    }
    const _this = this
    // create time map
    const timeArr = []
    // return combined data
    const combinedDataMap = new Map()
    const treasuryAddDataMap = new Map()
    if (data.treasuryAddSummary) {
      data.treasuryAddSummary.forEach((treasuryAdd) => {
        treasuryAddDataMap.set(treasuryAdd.month, treasuryAdd.invalue)
      })
    }
    if (data.treasurySummary) {
      data.treasurySummary.forEach((treasury) => {
        timeArr.push(treasury.month)
        // create object and insert to map
        const item = {
          month: treasury.month,
          invalue: treasury.invalue,
          invalueUSD: treasury.invalueUSD,
          outvalue: treasury.outvalue,
          outvalueUSD: treasury.outvalueUSD,
          difference: treasury.difference,
          differenceUSD: treasury.differenceUSD,
          total: treasury.total,
          totalUSD: treasury.totalUSD,
          outEstimate: treasury.outEstimate,
          outEstimateUsd: treasury.outEstimateUsd,
          monthPrice: treasury.monthPrice
        }
        // if has treasury add data, subtract from invalue
        if (treasuryAddDataMap.has(treasury.month)) {
          const addData = treasuryAddDataMap.get(treasury.month)
          item.invalue = addData > item.invalue ? 0 : item.invalue - addData
          item.difference = Math.abs(item.invalue - item.outvalue)
          item.differenceUSD = (item.difference / 100000000) * item.monthPrice
          item.invalueUSD = (item.invalue / 100000000) * item.monthPrice
        }
        combinedDataMap.set(treasury.month, item)
      })
    }
    if (data.legacySummary) {
      data.legacySummary.forEach((legacy) => {
        if (!timeArr.includes(legacy.month)) {
          timeArr.push(legacy.month)
          // create object and insert to map
          const item = {
            month: legacy.month,
            invalue: legacy.invalue,
            invalueUSD: legacy.invalueUSD,
            outvalue: legacy.outvalue,
            outvalueUSD: legacy.outvalueUSD,
            difference: legacy.difference,
            differenceUSD: legacy.differenceUSD,
            total: legacy.total,
            totalUSD: legacy.totalUSD,
            outEstimate: legacy.outEstimate,
            outEstimateUsd: legacy.outEstimateUsd,
            monthPrice: legacy.monthPrice
          }
          // if has treasury add data, subtract from outvalue
          if (treasuryAddDataMap.has(legacy.month)) {
            const addData = treasuryAddDataMap.get(legacy.month)
            item.outvalue = addData > item.outvalue ? 0 : item.outvalue - addData
            item.difference = Math.abs(item.invalue - item.outvalue)
            item.differenceUSD = (item.difference / 100000000) * item.monthPrice
            item.outvalueUSD = (item.outvalue / 100000000) * item.monthPrice
          }
          combinedDataMap.set(legacy.month, item)
        } else if (combinedDataMap.has(legacy.month)) {
          // if has in array (in map)
          const item = combinedDataMap.get(legacy.month)
          item.invalue += legacy.invalue
          item.invalueUSD += legacy.invalueUSD
          item.total += legacy.total
          item.totalUSD += legacy.totalUSD

          if (treasuryAddDataMap.has(legacy.month)) {
            const addData = treasuryAddDataMap.get(legacy.month)
            item.outValue += legacy.outvalue - addData
            if (item.outValue < 0) {
              item.outValue = 0.0
            }
            item.outvalueUSD = (item.outvalue / 100000000) * item.monthPrice
          } else {
            item.outvalue += legacy.outvalue
            item.outvalueUSD += legacy.outvalueUSD
          }
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
    return mainResult
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

  createTreasuryLegacyTableContent (summary) {
    const isLegacy = this.settings.ttype === 'legacy'
    let thead = '<thead>' +
      '<tr class="text-secondary finance-table-header">' +
      `<th class="va-mid text-center ps-0 month-col border-right-grey cursor-pointer" data-action="click->financereport#sortByCreateDate"><span class="${this.settings.tsort === 'newest' ? 'dcricon-arrow-down' : 'dcricon-arrow-up'} ${this.settings.stype && this.settings.stype !== '' ? 'c-grey-3' : ''} col-sort"></span></th>`
    const usdDisp = this.settings.usd === true || this.settings.usd === 'true'
    thead += `<th class="va-mid text-right-i ps-0 fs-13i ps-3 pr-3 fw-600 treasury-content-cell"><label class="cursor-pointer" data-action="click->financereport#sortByIncoming">Incoming (${usdDisp ? 'USD' : 'DCR'})</label>` +
    `<span data-action="click->financereport#sortByIncoming" class="${(this.settings.stype === 'incoming' && this.settings.order === 'desc') ? 'dcricon-arrow-down' : 'dcricon-arrow-up'} ${this.settings.stype !== 'incoming' ? 'c-grey-3' : ''} col-sort ms-1"></span></th>` +
    `<th class="va-mid text-right-i ps-0 fs-13i ps-3 pr-3 fw-600 treasury-content-cell"><label class="cursor-pointer" data-action="click->financereport#sortByOutgoing">Outgoing (${usdDisp ? 'USD' : 'DCR'})</label>` +
    `<span data-action="click->financereport#sortByOutgoing" class="${(this.settings.stype === 'outgoing' && this.settings.order === 'desc') ? 'dcricon-arrow-down' : 'dcricon-arrow-up'} ${this.settings.stype !== 'outgoing' ? 'c-grey-3' : ''} col-sort ms-1"></span></th>` +
    `<th class="va-mid text-right-i ps-0 fs-13i ps-3 pr-3 fw-600 treasury-content-cell"><label class="cursor-pointer" data-action="click->financereport#sortByNet">Net (${usdDisp ? 'USD' : 'DCR'})</label>` +
    `<span data-action="click->financereport#sortByNet" class="${(this.settings.stype === 'net' && this.settings.order === 'desc') ? 'dcricon-arrow-down' : 'dcricon-arrow-up'} ${this.settings.stype !== 'net' ? 'c-grey-3' : ''} col-sort ms-1"></span></th>` +
    `<th class="va-mid text-right-i ps-0 fs-13i ps-3 pr-3 fw-600 treasury-content-cell"><label class="cursor-pointer" data-action="click->financereport#sortByBalance">Balance (${usdDisp ? 'USD' : 'DCR'})</label>` +
    `<span data-action="click->financereport#sortByBalance" class="${(this.settings.stype === 'balance' && this.settings.order === 'desc') ? 'dcricon-arrow-down' : 'dcricon-arrow-up'} ${this.settings.stype !== 'balance' ? 'c-grey-3' : ''} col-sort ms-1"></span></th>`
    if (!isLegacy) {
      thead += `<th class="va-mid text-right-i ps-0 fs-13i ps-3 pr-3 fw-600 treasury-content-cell"><label class="cursor-pointer" data-action="click->financereport#sortByOutgoingEst">Outgoing (Est)(${usdDisp ? 'USD' : 'DCR'})</label>` +
      `<span data-action="click->financereport#sortByOutgoingEst" class="${(this.settings.stype === 'outest' && this.settings.order === 'desc') ? 'dcricon-arrow-down' : 'dcricon-arrow-up'} ${this.settings.stype !== 'outest' ? 'c-grey-3' : ''} col-sort ms-1"></span></th>`
    }
    if (usdDisp) {
      thead += '<th class="va-mid text-right-i ps-0 fs-13i ps-3 pr-3 fw-600 treasury-content-cell"><label class="cursor-pointer" data-action="click->financereport#sortByRate">Rate (USD/DCR)</label>' +
      `<span data-action="click->financereport#sortByRate" class="${(this.settings.stype === 'rate' && this.settings.order === 'desc') ? 'dcricon-arrow-down' : 'dcricon-arrow-up'} ${this.settings.stype !== 'rate' ? 'c-grey-3' : ''} col-sort ms-1"></span></th>`
    }
    thead += '</tr></thead>'
    let tbody = '<tbody>###</tbody>'
    let bodyList = ''
    // create tbody content
    let incomeTotal = 0; let outTotal = 0; let diffTotal = 0; let estimateOutTotal = 0
    const treasuryList = this.sortTreasury(summary)
    treasuryList.forEach((item) => {
      const timeParam = this.getFullTimeParam(item.month, '-')
      incomeTotal += usdDisp ? item.invalueUSD : item.invalue
      outTotal += usdDisp ? item.outvalueUSD : item.outvalue
      diffTotal += usdDisp ? item.differenceUSD : item.difference
      estimateOutTotal += usdDisp ? item.outEstimateUsd : item.outEstimate
      const netNegative = item.outvalue > item.invalue
      const incomDisplay = item.invalue <= 0 ? '' : usdDisp ? humanize.formatToLocalString(item.invalueUSD, 2, 2) : humanize.formatToLocalString((item.invalue / 100000000), 2, 2)
      const outcomeDisplay = item.outvalue <= 0 ? '' : usdDisp ? humanize.formatToLocalString(item.outvalueUSD, 2, 2) : humanize.formatToLocalString((item.outvalue / 100000000), 2, 2)
      const differenceDisplay = item.difference <= 0 ? '' : usdDisp ? humanize.formatToLocalString(item.differenceUSD, 2, 2) : humanize.formatToLocalString((item.difference / 100000000), 2, 2)
      const balanceDisplay = item.balance <= 0 ? '' : usdDisp ? humanize.formatToLocalString(item.balanceUSD, 2, 2) : humanize.formatToLocalString((item.balance / 100000000), 2, 2)
      let incomeHref = ''
      let outcomeHref = ''
      if (isLegacy) {
        incomeHref = '/address/' + this.devAddress + '?txntype=credit&time=' + (timeParam === '' ? item.month : timeParam)
        outcomeHref = '/address/' + this.devAddress + '?txntype=debit&time=' + (timeParam === '' ? item.month : timeParam)
      } else if (this.settings.ttype === 'current') {
        incomeHref = '/treasury?txntype=treasurybase&time=' + (timeParam === '' ? item.month : timeParam)
        outcomeHref = '/treasury?txntype=tspend&time=' + (timeParam === '' ? item.month : timeParam)
      }
      bodyList += '<tr>' +
        `<td class="va-mid text-center fs-13i fw-600 border-right-grey"><a class="link-hover-underline fs-13i" href="${'/finance-report/detail?type=' + this.settings.interval + '&time=' + (timeParam === '' ? item.month : timeParam)}">${item.month}</a></td>` +
        `<td class="va-mid text-right-i fs-13i treasury-content-cell">${incomeHref !== '' ? '<a class="link-hover-underline fs-13i" href="' + incomeHref + '">' : ''}${usdDisp && incomDisplay !== '' ? '$' : ''}${incomDisplay}${incomeHref !== '' ? '</a>' : ''}</td>` +
        `<td class="va-mid text-right-i fs-13i treasury-content-cell">${outcomeHref !== '' ? '<a class="link-hover-underline fs-13i" href="' + outcomeHref + '">' : ''}${usdDisp && outcomeDisplay !== '' ? '$' : ''}${outcomeDisplay}${outcomeHref !== '' ? '</a>' : ''}</td>` +
        `<td class="va-mid text-right-i fs-13i treasury-content-cell">${netNegative ? '-' : ''}${usdDisp && differenceDisplay !== '' ? '$' : ''}${differenceDisplay}</td>`
      bodyList += `<td class="va-mid text-right-i fs-13i treasury-content-cell">${usdDisp && balanceDisplay !== '' ? '$' : ''}${balanceDisplay}</td>`
      if (!isLegacy) {
        bodyList += `<td class="va-mid text-right-i fs-13i treasury-content-cell">${usdDisp && item.outEstimate !== 0.0 ? '$' : ''}${item.outEstimate === 0.0 ? '' : usdDisp ? humanize.formatToLocalString(item.outEstimateUsd, 2, 2) : humanize.formatToLocalString(item.outEstimate, 2, 2)}</td>`
      }
      if (usdDisp) {
        bodyList += `<td class="va-mid text-right-i fs-13i treasury-content-cell">$${humanize.formatToLocalString(item.monthPrice, 2, 2)}</td>`
      }
      bodyList += '</tr>'
    })
    const totalIncomDisplay = usdDisp ? humanize.formatToLocalString(incomeTotal, 2, 2) : humanize.formatToLocalString((incomeTotal / 100000000), 2, 2)
    const totalOutcomeDisplay = usdDisp ? humanize.formatToLocalString(outTotal, 2, 2) : humanize.formatToLocalString((outTotal / 100000000), 2, 2)
    const totalDifferenceDisplay = usdDisp ? humanize.formatToLocalString(diffTotal, 2, 2) : humanize.formatToLocalString((diffTotal / 100000000), 2, 2)
    const totalEstimateOutgoing = usdDisp ? humanize.formatToLocalString(estimateOutTotal, 2, 2) : humanize.formatToLocalString(estimateOutTotal, 2, 2)
    const totalNetNegative = outTotal > incomeTotal
    bodyList += '<tr class="va-mid finance-table-header"><td class="text-center fw-600 fs-15i border-right-grey">Total</td>'
    bodyList += `<td class="va-mid text-right-i fw-600 fs-13i treasury-content-cell">${usdDisp ? '$' : ''}${totalIncomDisplay}</td>`
    bodyList += `<td class="va-mid text-right-i fw-600 fs-13i treasury-content-cell">${usdDisp ? '$' : ''}${totalOutcomeDisplay}</td>`
    bodyList += `<td class="va-mid text-right-i fw-600 fs-13i treasury-content-cell">${totalNetNegative ? '-' : ''}${usdDisp ? '$' : ''}${totalDifferenceDisplay}</td>`
    bodyList += '<td class="va-mid text-right-i fw-600 fs-13i treasury-content-cell"></td>'
    if (!isLegacy) {
      bodyList += `<td class="va-mid text-right-i fw-600 fs-13i treasury-content-cell">${usdDisp ? '$' : ''}${totalEstimateOutgoing}</td>`
    }
    if (usdDisp) {
      bodyList += '<td class="va-mid text-right-i fw-600 fs-13i treasury-content-cell"></td>'
    }
    bodyList += '</tr>'

    tbody = tbody.replace('###', bodyList)
    return thead + tbody
  }

  // Calculate and response
  async calculate (redrawFlg) {
    this.setReportTitle()
    if (this.settings.type === 'treasury') {
      this.searchBoxTarget.classList.add('d-none')
      this.searchBoxTarget.classList.remove('report-search-box')
      this.searchInputTarget.value = ''
      this.settings.search = this.defaultSettings.search
    } else {
      if (this.settings.type !== 'domain') {
        this.settings.chart = this.defaultSettings.chart
        this.settings.zoom = ''
        this.settings.bin = this.defaultSettings.bin
        this.settings.flow = this.defaultSettings.flow
      }
      this.searchBoxTarget.classList.remove('d-none')
      if (this.settings.type === 'author' || this.settings.type === 'proposal') {
        this.searchBoxTarget.classList.remove('ms-3')
      } else {
        this.searchBoxTarget.classList.add('ms-3')
      }
      this.settings.usd = false
    }

    if (!this.settings.type || this.settings.type === '' || this.settings.type === 'proposal' || this.settings.type === 'summary') {
      this.nameMatrixSwitchTarget.classList.remove('d-none')
      if (this.settings.type === 'proposal') {
        document.getElementById('nameMonthSwitchInput').checked = true
      } else {
        document.getElementById('nameMonthSwitchInput').checked = false
      }
    } else {
      this.nameMatrixSwitchTarget.classList.add('d-none')
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
        this.createReportTable(redrawFlg)
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
    if (this.settings.type === 'domain') {
      domainYearData = this.getProposalYearlyData(responseData)
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
    this.createReportTable(redrawFlg)
    this.enabledGroupButton()
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
      domainChartData = {}
      domainChartYearData = {}
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

  treasuryUsdChange (e) {
    const switchCheck = document.getElementById('usdSwitchInput').checked
    this.settings.usd = switchCheck
    this.calculate(false)
  }

  activeProposalSwitch (e) {
    const switchCheck = document.getElementById('activeProposalInput').checked
    this.settings.active = switchCheck.toString()
    this.calculate(false)
  }

  nameMatrixSwitchEvent (e) {
    const switchCheck = document.getElementById('nameMonthSwitchInput').checked
    this.settings.type = !switchCheck || switchCheck === 'false' ? 'summary' : 'proposal'
    this.calculate(false)
  }

  proposalReportTimeDetail (e) {
    const idArr = e.target.id.split(';')
    if (idArr.length !== 2) {
      return
    }
    window.location.href = '/finance-report/detail?type=' + idArr[0] + '&time=' + idArr[1].replace('/', '_')
  }

  get chartType () {
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
