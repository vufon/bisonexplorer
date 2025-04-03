import { Controller } from '@hotwired/stimulus'
import dompurify from 'dompurify'
import { assign, map, merge } from 'lodash-es'
import { animationFrame } from '../helpers/animation_helper'
import { isEqual } from '../helpers/chart_helper'
import { requestJSON } from '../helpers/http'
import humanize from '../helpers/humanize_helper'
import { getDefault } from '../helpers/module_helper'
import TurboQuery from '../helpers/turbolinks_helper'
import Zoom from '../helpers/zoom_helper'
import globalEventBus from '../services/event_bus_service'
import { darkEnabled } from '../services/theme_service'

let selectedChart
let Dygraph // lazy loaded on connect

const aDay = 86400 * 1000 // in milliseconds
const aMonth = 30 // in days
const atomsToDCR = 1e-8
const windowScales = ['ticket-price', 'pow-difficulty', 'missed-votes']
const rangeUse = ['hashrate', 'pow-difficulty']
const hybridScales = ['privacy-participation']
const lineScales = ['ticket-price', 'privacy-participation']
const modeScales = ['ticket-price']
const multiYAxisChart = ['ticket-price', 'coin-supply', 'privacy-participation']
// index 0 represents y1 and 1 represents y2 axes.
const yValueRanges = { 'ticket-price': [1] }
const chainworkUnits = ['exahash', 'zettahash', 'yottahash']
const hashrateUnits = ['Th/s', 'Ph/s', 'Eh/s']
let ticketPoolSizeTarget, premine, stakeValHeight, stakeShare
let baseSubsidy, subsidyInterval, subsidyExponent, windowSize, avgBlockTime
let rawCoinSupply, rawPoolValue
let yFormatter, legendEntry, legendMarker, legendElement
let rangeOption = ''
const yAxisLabelWidth = {
  y1: {
    'ticket-price': 30,
    'ticket-pool-size': 30,
    'ticket-pool-value': 30,
    'stake-participation': 30,
    'privacy-participation': 40,
    'missed-votes': 30,
    'block-size': 35,
    'blockchain-size': 30,
    'tx-count': 45,
    'duration-btw-blocks': 40,
    'pow-difficulty': 40,
    chainwork: 35,
    hashrate: 40,
    'coin-supply': 30,
    fees: 35
  },
  y2: {
    'ticket-price': 45
  }
}

function usesWindowUnits (chart) {
  return windowScales.indexOf(chart) > -1
}

function usesHybridUnits (chart) {
  return hybridScales.indexOf(chart) > -1
}

function isScaleDisabled (chart) {
  return lineScales.indexOf(chart) > -1
}

function isModeEnabled (chart) {
  return modeScales.includes(chart)
}

function hasMultipleVisibility (chart) {
  return multiYAxisChart.indexOf(chart) > -1
}

function useRange (chart) {
  return rangeUse.indexOf(chart) > -1
}

function intComma (amount) {
  if (!amount) return ''
  return amount.toLocaleString(undefined, { maximumFractionDigits: 0 })
}

function isMobile () {
  return window.innerWidth <= 768
}

function axesToRestoreYRange (chartName, origYRange, newYRange) {
  const axesIndexes = yValueRanges[chartName]
  if (!Array.isArray(origYRange) || !Array.isArray(newYRange) ||
    origYRange.length !== newYRange.length || !axesIndexes) return

  let axes
  for (let i = 0; i < axesIndexes.length; i++) {
    const index = axesIndexes[i]
    if (newYRange.length <= index) continue
    if (!isEqual(origYRange[index], newYRange[index])) {
      if (!axes) axes = {}
      if (index === 0) {
        axes = Object.assign(axes, { y1: { valueRange: origYRange[index] } })
      } else if (index === 1) {
        axes = Object.assign(axes, { y2: { valueRange: origYRange[index] } })
      }
    }
  }
  return axes
}

function withBigUnits (v, units) {
  const i = v === 0 ? 0 : Math.floor(Math.log10(v) / 3)
  return (v / Math.pow(1000, i)).toFixed(3) + ' ' + units[i]
}

function blockReward (height) {
  if (height >= stakeValHeight) return baseSubsidy * Math.pow(subsidyExponent, Math.floor(height / subsidyInterval))
  if (height > 1) return baseSubsidy * (1 - stakeShare)
  if (height === 1) return premine
  return 0
}

function addLegendEntryFmt (div, series, fmt) {
  div.appendChild(legendEntry(`${series.dashHTML} ${series.labelHTML}: ${fmt(series.y)}`))
}

function addLegendEntry (div, series) {
  div.appendChild(legendEntry(`${series.dashHTML} ${series.labelHTML}: ${series.yHTML}`))
}

function defaultYFormatter (div, data) {
  addLegendEntry(div, data.series[0])
}

function customYFormatter (fmt) {
  return (div, data) => addLegendEntryFmt(div, data.series[0], fmt)
}

function legendFormatter (data) {
  if (data.x == null) return legendElement.classList.add('d-hide')
  legendElement.classList.remove('d-hide')
  const div = document.createElement('div')
  let xHTML = data.xHTML
  if (data.dygraph.getLabels()[0] === 'Date') {
    xHTML = humanize.date(data.x, false, selectedChart !== 'ticket-price')
  }
  div.appendChild(legendEntry(`${data.dygraph.getLabels()[0]}: ${xHTML}`))
  yFormatter(div, data, data.dygraph.getOption('legendIndex'))
  dompurify.sanitize(div, { IN_PLACE: true, FORBID_TAGS: ['svg', 'math'] })
  return div.innerHTML
}

function hashrateTimePlotter (e) {
  // ASIC miners get turned on
  const asicLines = ['● ASIC miners', 'get turned on']
  hashrateLegendPlotter(e, 1546339611000, 197, asicLines, 'left')
  // Miner reward change 60% to 10%
  const minerLines = ['● Miner reward', 'change 60% to 10%']
  hashrateLegendPlotter(e, 1652266011000, 150, minerLines, 'right')
  if (rangeOption !== 'before' || rangeOption !== 'after') {
    const lines = ['● Transition of the', 'algorithm to BLAKE3', '● Miner reward', 'change 10% to 1%']
    hashrateLegendPlotter(e, 1693612800000, 0, lines, 'right')
  }
}

function hashrateBlockPlotter (e) {
  // ASIC miners get turned on
  const asicLines = ['● ASIC miners', 'get turned on']
  hashrateLegendPlotter(e, 306247, 197, asicLines, 'left')
  // Miner reward change 60% to 10%
  const minerLines = ['● Miner reward', 'change 60% to 10%']
  hashrateLegendPlotter(e, 658518, 150, minerLines, 'right')
  if (rangeOption !== 'before' || rangeOption !== 'after') {
    const lines = ['● Transition of the', 'algorithm to BLAKE3', '● Miner reward', 'change 10% to 1%']
    hashrateLegendPlotter(e, 794429, 0, lines, 'right')
  }
}

function difficultyTimePlotter (e) {
  // ASIC miners get turned on
  const asicLines = ['● ASIC miners', 'get turned on']
  hashrateLegendPlotter(e, 1546339611000, 11500000000, asicLines, 'left')
  // Miner reward change 60% to 10%
  const minerLines = ['● Miner reward', 'change 60% to 10%']
  hashrateLegendPlotter(e, 1652266011000, 10000000000, minerLines, 'right')
  if (rangeOption !== 'before' || rangeOption !== 'after') {
    const lines = ['● Transition of the', 'algorithm to BLAKE3', '● Miner reward', 'change 10% to 1%']
    hashrateLegendPlotter(e, 1693612800000, 0, lines, 'right')
  }
}

function difficultyBlockPlotter (e) {
  // ASIC miners get turned on
  const asicLines = ['● ASIC miners', 'get turned on']
  hashrateLegendPlotter(e, 306247, 11500000000, asicLines, 'left')
  // Miner reward change 60% to 10%
  const minerLines = ['● Miner reward', 'change 60% to 10%']
  hashrateLegendPlotter(e, 658518, 10000000000, minerLines, 'right')
  if (rangeOption !== 'before' || rangeOption !== 'after') {
    const lines = ['● Transition of the', 'algorithm to BLAKE3', '● Miner reward', 'change 10% to 1%']
    hashrateLegendPlotter(e, 794429, 0, lines, 'right')
  }
}

function makePt (x, y) { return { x, y } }

// Legend plotter processing for hashrate chart for blake3 algorithm transition
function hashrateLegendPlotter (e, midGapValue, startY, lines, direct) {
  Dygraph.Plotters.fillPlotter(e)
  Dygraph.Plotters.linePlotter(e)
  const area = e.plotArea
  const ctx = e.drawingContext
  const mg = e.dygraph.toDomCoords(midGapValue, startY)
  const midGap = makePt(mg[0], mg[1])
  const fontSize = 13
  const dark = darkEnabled()
  ctx.textAlign = 'left'
  ctx.textBaseline = 'top'
  ctx.font = `${fontSize}px arial`
  ctx.lineWidth = 1
  ctx.strokeStyle = dark ? '#ffffff' : '#259331'
  const boxColor = dark ? '#1e2b39' : '#ffffff'
  let boxW = 0
  const txts = [...lines]
  txts.forEach(txt => {
    const w = ctx.measureText(txt).width
    if (w > boxW) boxW = w
  })
  let rowHeight = fontSize * 1.5
  const rowPad = (rowHeight - fontSize) / 3
  const boxPad = rowHeight / 5
  let y = fontSize
  y += midGap.y - 2 * area.h / 3
  // Label the gap size.
  rowHeight -= 2 // just looks better
  ctx.fillStyle = boxColor
  const reactX = direct === 'left' ? midGap.x - boxW - boxPad * 2 : midGap.x + boxPad
  const rect = makePt(reactX, y - boxPad)
  const dims = makePt(boxW + boxPad * 3, rowHeight * lines.length + boxPad * 2)
  ctx.fillRect(rect.x, rect.y, dims.x, dims.y)
  ctx.strokeRect(rect.x, rect.y, dims.x, dims.y)
  ctx.fillStyle = dark ? '#ffffff' : '#259331'
  const centerX = direct === 'left' ? midGap.x - boxW / 2 - 4 : midGap.x + boxW / 2 + 8
  const write = s => {
    const cornerX = centerX - (ctx.measureText(s).width / 2)
    ctx.fillText(s, cornerX + rowPad, y + rowPad)
    y += rowHeight
  }

  ctx.save()
  lines.forEach((line) => {
    write(line)
  })
  // Draw a line from the box to the gap
  const lineToX = direct === 'left' ? midGap.x - boxW / 2 : midGap.x + boxW / 2
  drawLine(ctx,
    makePt(lineToX, y),
    makePt(midGap.x, midGap.y - boxPad))
}

function drawLine (ctx, start, end) {
  ctx.beginPath()
  ctx.moveTo(start.x, start.y)
  ctx.lineTo(end.x, end.y)
  ctx.stroke()
}

function nightModeOptions (nightModeOn) {
  if (nightModeOn) {
    return {
      rangeSelectorAlpha: 0.3,
      gridLineColor: '#596D81',
      colors: ['#2DD8A3', '#255595', '#FFC84E']
    }
  }
  return {
    rangeSelectorAlpha: 0.4,
    gridLineColor: '#C4CBD2',
    colors: ['#255594', '#006600', '#FF0090']
  }
}

function zipWindowHvYZ (ys, zs, winSize, yMult, zMult, offset) {
  yMult = yMult || 1
  zMult = zMult || 1
  offset = offset || 0
  return ys.map((y, i) => {
    return [i * winSize + offset, y * yMult, zs[i] * zMult]
  })
}

function zipWindowHvY (ys, winSize, yMult, offset) {
  yMult = yMult || 1
  offset = offset || 0
  return ys.map((y, i) => {
    return [i * winSize + offset, y * yMult]
  })
}

function zipWindowTvYZ (times, ys, zs, yMult, zMult) {
  yMult = yMult || 1
  zMult = zMult || 1
  return times.map((t, i) => {
    return [new Date(t * 1000), ys[i] * yMult, zs[i] * zMult]
  })
}

function zipWindowTvY (times, ys, yMult) {
  yMult = yMult || 1
  return times.map((t, i) => {
    return [new Date(t * 1000), ys[i] * yMult]
  })
}

function zipTvY (times, ys, yMult) {
  yMult = yMult || 1
  return times.map((t, i) => {
    return [new Date(t * 1000), ys[i] * yMult]
  })
}

function zipIvY (ys, yMult, offset) {
  yMult = yMult || 1
  offset = offset || 1 // TODO: check for why offset is set to a default value of 1 when genesis block has a height of 0
  return ys.map((y, i) => {
    return [offset + i, y * yMult]
  })
}

function zipHvY (heights, ys, yMult, offset) {
  yMult = yMult || 1
  offset = offset || 1
  return ys.map((y, i) => {
    return [offset + heights[i], y * yMult]
  })
}

function zip2D (data, ys, yMult, offset) {
  yMult = yMult || 1
  if (data.axis === 'height') {
    if (data.bin === 'block') return zipIvY(ys, yMult)
    return zipHvY(data.h, ys, yMult, offset)
  }
  return zipTvY(data.t, ys, yMult)
}

function anonymitySetFunc (data) {
  let d
  let start = -1
  let end = 0
  if (data.axis === 'height') {
    if (data.bin === 'block') {
      d = data.anonymitySet.map((y, i) => {
        if (start === -1 && y > 0) {
          start = i
        }
        end = i
        return [i, y * atomsToDCR]
      })
    } else {
      d = data.anonymitySet.map((y, i) => {
        if (start === -1 && y > 0) {
          start = i
        }
        end = data.h[i]
        return [data.h[i], y * atomsToDCR]
      })
    }
  } else {
    d = data.t.map((t, i) => {
      if (start === -1 && data.anonymitySet[i] > 0) {
        start = t * 1000
      }
      end = t * 1000
      return [new Date(t * 1000), data.anonymitySet[i] * atomsToDCR]
    })
  }
  return { data: d, limits: [start, end] }
}

function ticketPriceFunc (data) {
  if (data.t) return zipWindowTvYZ(data.t, data.price, data.count, atomsToDCR)
  return zipWindowHvYZ(data.price, data.count, data.window, atomsToDCR)
}

function poolSizeFunc (data) {
  let out = []
  if (data.axis === 'height') {
    if (data.bin === 'block') out = zipIvY(data.count)
    else out = zipHvY(data.h, data.count)
  } else {
    out = zipTvY(data.t, data.count)
  }
  out.forEach(pt => pt.push(null))
  if (out.length) {
    out[0][2] = ticketPoolSizeTarget
    out[out.length - 1][2] = ticketPoolSizeTarget
  }
  return out
}

function percentStakedFunc (data) {
  rawCoinSupply = data.circulation.map(v => v * atomsToDCR)
  rawPoolValue = data.poolval.map(v => v * atomsToDCR)
  const ys = rawPoolValue.map((v, i) => [v / rawCoinSupply[i] * 100])
  if (data.axis === 'height') {
    if (data.bin === 'block') return zipIvY(ys)
    return zipHvY(data.h, ys)
  }
  return zipTvY(data.t, ys)
}

function powDiffFunc (data) {
  if (data.t) return zipWindowTvY(data.t, data.diff)
  return zipWindowHvY(data.diff, data.window, 1, data.offset)
}

function circulationFunc (chartData) {
  let yMax = 0
  let h = -1
  const addDough = (newHeight) => {
    while (h < newHeight) {
      h++
      yMax += blockReward(h) * atomsToDCR
    }
  }
  const heights = chartData.h
  const times = chartData.t
  const supplies = chartData.supply
  const anonymitySet = chartData.anonymitySet
  const isHeightAxis = chartData.axis === 'height'
  let xFunc, hFunc
  if (chartData.bin === 'day') {
    xFunc = isHeightAxis ? i => heights[i] : i => new Date(times[i] * 1000)
    hFunc = i => heights[i]
  } else {
    xFunc = isHeightAxis ? i => i : i => new Date(times[i] * 1000)
    hFunc = i => i
  }

  const inflation = []
  const data = map(supplies, (n, i) => {
    const height = hFunc(i)
    addDough(height)
    inflation.push(yMax)
    return [xFunc(i), supplies[i] * atomsToDCR, null, anonymitySet[i] * atomsToDCR]
  })

  const dailyBlocks = aDay / avgBlockTime
  const lastPt = data[data.length - 1]
  let x = lastPt[0]
  // Set yMax to the start at last actual supply for the prediction line.
  yMax = lastPt[1]
  if (!isHeightAxis) x = x.getTime()
  xFunc = isHeightAxis ? xx => xx : xx => { return new Date(xx) }
  const xIncrement = isHeightAxis ? dailyBlocks : aDay
  const projection = 6 * aMonth
  data.push([xFunc(x), null, yMax, null])
  for (let i = 1; i <= projection; i++) {
    addDough(h + dailyBlocks)
    x += xIncrement
    data.push([xFunc(x), null, yMax, null])
  }
  return { data, inflation }
}

function missedVotesFunc (data) {
  if (data.t) return zipWindowTvY(data.t, data.missed)
  return zipWindowHvY(data.missed, data.window, 1, data.offset * data.window)
}

function mapDygraphOptions (data, labelsVal, isDrawPoint, yLabel, labelsMG, labelsMG2) {
  return merge({
    file: data,
    labels: labelsVal,
    drawPoints: isDrawPoint,
    ylabel: yLabel,
    labelsKMB: labelsMG2 && labelsMG ? false : labelsMG,
    labelsKMG2: labelsMG2 && labelsMG ? false : labelsMG2
  }, nightModeOptions(darkEnabled()))
}

export default class extends Controller {
  static get targets () {
    return [
      'chartWrapper',
      'labels',
      'chartsView',
      'chartSelect',
      'zoomSelector',
      'zoomOption',
      'scaleType',
      'axisOption',
      'binSelector',
      'scaleSelector',
      'ticketsPurchase',
      'ticketsPrice',
      'anonymitySet',
      'vSelectorItem',
      'vSelector',
      'binSize',
      'legendEntry',
      'legendMarker',
      'modeSelector',
      'modeOption',
      'rawDataURL',
      'chartName',
      'chartTitleName',
      'rangeSelector',
      'rangeOption'
    ]
  }

  async connect () {
    this.isHomepage = !window.location.href.includes('/charts')
    this.query = new TurboQuery()
    ticketPoolSizeTarget = parseInt(this.data.get('tps'))
    premine = parseInt(this.data.get('premine'))
    stakeValHeight = parseInt(this.data.get('svh'))
    stakeShare = parseInt(this.data.get('pos')) / 10.0
    baseSubsidy = parseInt(this.data.get('bs'))
    subsidyInterval = parseInt(this.data.get('sri'))
    subsidyExponent = parseFloat(this.data.get('mulSubsidy')) / parseFloat(this.data.get('divSubsidy'))
    windowSize = parseInt(this.data.get('windowSize'))
    avgBlockTime = parseInt(this.data.get('blockTime')) * 1000
    const supplyPage = this.data.get('supplyPage')
    legendElement = this.labelsTarget

    // Prepare the legend element generators.
    const lm = this.legendMarkerTarget
    lm.remove()
    lm.removeAttribute('data-charts-target')
    legendMarker = () => {
      const node = document.createElement('div')
      node.appendChild(lm.cloneNode())
      return node.innerHTML
    }
    const le = this.legendEntryTarget
    le.remove()
    le.removeAttribute('data-charts-target')
    legendEntry = s => {
      const node = le.cloneNode()
      node.innerHTML = s
      return node
    }

    this.settings = TurboQuery.nullTemplate(['chart', 'zoom', 'scale', 'bin', 'range', 'axis', 'visibility', 'home'])
    if (!this.isHomepage) {
      this.query.update(this.settings)
    }
    this.settings.chart = this.settings.chart || 'ticket-price'
    if (supplyPage === 'true') {
      this.settings.chart = 'coin-supply'
    }
    this.zoomCallback = this._zoomCallback.bind(this)
    this.drawCallback = this._drawCallback.bind(this)
    this.limits = null
    this.lastZoom = null
    this.visibility = []
    if (this.settings.visibility) {
      this.settings.visibility.split('-', -1).forEach(s => {
        this.visibility.push(s === 'true')
      })
    }
    Dygraph = await getDefault(
      import(/* webpackChunkName: "dygraphs" */ '../vendor/dygraphs.min.js')
    )
    this.drawInitialGraph()
    this.processNightMode = (params) => {
      this.chartsView.updateOptions(
        nightModeOptions(params.nightMode)
      )
    }
    globalEventBus.on('NIGHT_MODE', this.processNightMode)
  }

  disconnect () {
    globalEventBus.off('NIGHT_MODE', this.processNightMode)
    if (this.chartsView !== undefined) {
      this.chartsView.destroy()
    }
    selectedChart = null
  }

  drawInitialGraph () {
    const options = {
      axes: { y: { axisLabelWidth: 50 }, y2: { axisLabelWidth: 55 } },
      labels: ['Date', 'Ticket Price', 'Tickets Bought'],
      digitsAfterDecimal: 8,
      showRangeSelector: true,
      rangeSelectorPlotFillColor: '#C4CBD2',
      rangeSelectorAlpha: 0.4,
      rangeSelectorHeight: 40,
      drawPoints: true,
      pointSize: 0.25,
      legend: 'always',
      labelsSeparateLines: true,
      labelsDiv: legendElement,
      legendFormatter: legendFormatter,
      highlightCircleSize: 4,
      ylabel: 'Ticket Price',
      y2label: 'Tickets Bought',
      labelsUTC: true,
      axisLineColor: '#C4CBD2'
    }

    this.chartsView = new Dygraph(
      this.chartsViewTarget,
      [[1, 1, 5], [2, 5, 11]],
      options
    )
    this.setSelectedChart(this.settings.chart)
    if (this.settings.axis) this.setAxis(this.settings.axis) // set first
    if (this.settings.scale === 'log') this.setScale(this.settings.scale)
    // default on mobile is year, on other is all
    if (humanize.isEmpty(this.settings.zoom) && isMobile()) {
      this.settings.zoom = 'year'
    }
    if (this.settings.zoom) this.setZoom(this.settings.zoom)
    this.setBin(this.settings.bin ? this.settings.bin : 'day')
    this.setRange(this.settings.range ? this.settings.range : 'after')
    this.setMode(this.settings.mode ? this.settings.mode : 'smooth')

    const ogLegendGenerator = Dygraph.Plugins.Legend.generateLegendHTML
    Dygraph.Plugins.Legend.generateLegendHTML = (g, x, pts, w, row) => {
      g.updateOptions({ legendIndex: row }, true)
      return ogLegendGenerator(g, x, pts, w, row)
    }
    this.selectChart()
  }

  plotGraph (chartName, data) {
    let d = []
    const gOptions = {
      zoomCallback: null,
      drawCallback: null,
      logscale: this.settings.scale === 'log',
      valueRange: [null, null],
      visibility: null,
      y2label: null,
      y3label: null,
      stepPlot: this.settings.mode === 'stepped',
      axes: {},
      series: null,
      inflation: null,
      plotter: null
    }
    rawPoolValue = []
    rawCoinSupply = []
    yFormatter = defaultYFormatter
    const xlabel = data.t ? 'Date' : 'Block Height'
    const _this = this
    const isHeightBlock = data.axis === 'height' && data.bin === 'block'
    switch (chartName) {
      case 'ticket-price': // price graph
        d = ticketPriceFunc(data)
        assign(gOptions, mapDygraphOptions(d, [xlabel, 'Price', 'Tickets Bought'], true,
          'Price (DCR)', true, false))
        gOptions.y2label = 'Tickets Bought'
        gOptions.series = { 'Tickets Bought': { axis: 'y2' } }
        this.visibility = [this.getTargetsChecked(this.ticketsPriceTargets), this.getTargetsChecked(this.ticketsPurchaseTargets)]
        gOptions.visibility = this.visibility
        gOptions.axes.y2 = {
          valueRange: [0, windowSize * 20 * 8],
          axisLabelFormatter: (y) => Math.round(y),
          axisLabelWidth: isMobile() ? yAxisLabelWidth.y2['ticket-price'] : yAxisLabelWidth.y2['ticket-price'] + 15
        }
        yFormatter = customYFormatter(y => y.toFixed(8) + ' DCR')
        break
      case 'ticket-pool-size': // pool size graph
        d = poolSizeFunc(data)
        assign(gOptions, mapDygraphOptions(d, [xlabel, 'Ticket Pool Size', 'Network Target'],
          false, 'Ticket Pool Size', true, false))
        gOptions.series = {
          'Network Target': {
            strokePattern: [5, 3],
            connectSeparatedPoints: true,
            strokeWidth: 2,
            color: '#C4CBD2'
          }
        }
        yFormatter = customYFormatter(y => `${intComma(y)} tickets &nbsp;&nbsp; (network target ${intComma(ticketPoolSizeTarget)})`)
        break

      case 'stake-participation':
        d = percentStakedFunc(data)
        assign(gOptions, mapDygraphOptions(d, [xlabel, 'Stake Participation'], true,
          'Stake Participation (%)', true, false))
        yFormatter = (div, data, i) => {
          addLegendEntryFmt(div, data.series[0], y => y.toFixed(4) + '%')
          div.appendChild(legendEntry(`${legendMarker()} Ticket Pool Value: ${intComma(rawPoolValue[i])} DCR`))
          div.appendChild(legendEntry(`${legendMarker()} Coin Supply: ${intComma(rawCoinSupply[i])} DCR`))
        }
        break

      case 'ticket-pool-value': // pool value graph
        d = zip2D(data, data.poolval, atomsToDCR)
        assign(gOptions, mapDygraphOptions(d, [xlabel, 'Ticket Pool Value'], true,
          'Ticket Pool Value (DCR)', true, false))
        yFormatter = customYFormatter(y => intComma(y) + ' DCR')
        break

      case 'block-size': // block size graph
        d = zip2D(data, data.size)
        assign(gOptions, mapDygraphOptions(d, [xlabel, 'Block Size'], false, 'Block Size', true, false))
        break

      case 'blockchain-size': // blockchain size graph
        d = zip2D(data, data.size)
        assign(gOptions, mapDygraphOptions(d, [xlabel, 'Blockchain Size'], true,
          'Blockchain Size', false, true))
        break

      case 'tx-count': // tx per block graph
        d = zip2D(data, data.count)
        assign(gOptions, mapDygraphOptions(d, [xlabel, 'Number of Transactions'], false,
          '# of Transactions', false, false))
        break

      case 'pow-difficulty': // difficulty graph
        d = powDiffFunc(data)
        assign(gOptions, mapDygraphOptions(d, [xlabel, 'Difficulty'], true, 'Difficulty', true, false))
        if (_this.settings.range !== 'after') {
          gOptions.plotter = _this.settings.axis === 'height' ? difficultyBlockPlotter : difficultyTimePlotter
        }
        break

      case 'coin-supply': // supply graph
        d = circulationFunc(data)
        assign(gOptions, mapDygraphOptions(d.data, [xlabel, 'Coin Supply', 'Inflation Limit', 'Mix Rate'],
          true, 'Coin Supply (DCR)', true, false))
        gOptions.y2label = 'Inflation Limit'
        gOptions.y3label = 'Mix Rate'
        gOptions.series = { 'Inflation Limit': { axis: 'y2' }, 'Mix Rate': { axis: 'y3' } }
        this.visibility = [true, true, this.getTargetsChecked(this.anonymitySetTargets)]
        gOptions.visibility = this.visibility
        gOptions.series = {
          'Inflation Limit': {
            strokePattern: [5, 5],
            color: '#C4CBD2',
            strokeWidth: 1.5
          },
          'Mix Rate': {
            color: '#2dd8a3'
          }
        }
        gOptions.inflation = d.inflation
        yFormatter = (div, data, i) => {
          addLegendEntryFmt(div, data.series[0], y => intComma(y) + ' DCR')
          let change = 0
          if (i < d.inflation.length) {
            const supply = data.series[0].y
            if (this.getTargetsChecked(this.anonymitySetTargets)) {
              const mixed = data.series[2].y
              const mixedPercentage = ((mixed / supply) * 100).toFixed(2)
              div.appendChild(legendEntry(`${legendMarker()} Mixed: ${intComma(mixed)} DCR (${mixedPercentage}%)`))
            }
            const predicted = d.inflation[i]
            const unminted = predicted - data.series[0].y
            change = ((unminted / predicted) * 100).toFixed(2)
            div.appendChild(legendEntry(`${legendMarker()} Unminted: ${intComma(unminted)} DCR (${change}%)`))
          }
        }
        break

      case 'fees': // block fee graph
        d = zip2D(data, data.fees, atomsToDCR)
        assign(gOptions, mapDygraphOptions(d, [xlabel, 'Total Fee'], false, 'Total Fee (DCR)', true, false))
        yFormatter = customYFormatter(y => y.toFixed(8) + ' DCR')
        break

      case 'privacy-participation': { // anonymity set graph
        d = anonymitySetFunc(data)
        this.customLimits = d.limits
        const label = 'Mix Rate'
        assign(gOptions, mapDygraphOptions(d.data, [xlabel, label], false, `${label} (DCR)`, true, false))

        yFormatter = (div, data, i) => {
          addLegendEntryFmt(div, data.series[0], y => (y > 0 ? intComma(y) : '0') + ' DCR')
        }
        break
      }
      case 'duration-btw-blocks': // Duration between blocks graph
        d = zip2D(data, data.duration, 1, 1)
        assign(gOptions, mapDygraphOptions(d, [xlabel, 'Duration Between Blocks'], false,
          'Duration Between Blocks (seconds)', false, false))
        break

      case 'chainwork': // Total chainwork over time
        d = zip2D(data, data.work)
        assign(gOptions, mapDygraphOptions(d, [xlabel, 'Cumulative Chainwork'],
          false, 'Cumulative Chainwork (exahash)', true, false))
        yFormatter = customYFormatter(y => withBigUnits(y, chainworkUnits))
        break

      case 'hashrate': // Total chainwork over time
        d = isHeightBlock ? zipHvY(data.h, data.rate, 1e-3, data.offset) : zip2D(data, data.rate, 1e-3, data.offset)
        assign(gOptions, mapDygraphOptions(d, [xlabel, 'Network Hashrate'],
          false, 'Network Hashrate (petahash/s)', true, false))
        yFormatter = customYFormatter(y => withBigUnits(y * 1e3, hashrateUnits))
        if (_this.settings.range !== 'after') {
          gOptions.plotter = _this.settings.axis === 'height' ? hashrateBlockPlotter : hashrateTimePlotter
        }
        break

      case 'missed-votes':
        d = missedVotesFunc(data)
        assign(gOptions, mapDygraphOptions(d, [xlabel, 'Missed Votes'], false,
          'Missed Votes per Window', true, false))
        break
    }
    gOptions.axes.y = {
      axisLabelWidth: isMobile() ? yAxisLabelWidth.y1[chartName] : yAxisLabelWidth.y1[chartName] + 15
    }
    const baseURL = `${this.query.url.protocol}//${this.query.url.host}`
    this.rawDataURLTarget.textContent = `${baseURL}/api/chart/${chartName}?axis=${this.settings.axis}&bin=${this.settings.bin}`

    this.chartsView.plotter_.clear()
    this.chartsView.updateOptions(gOptions, false)
    if (yValueRanges[chartName]) this.supportedYRange = this.chartsView.yAxisRanges()
    this.validateZoom()
  }

  async selectChart () {
    const selectChart = this.getSelectedChart()
    const selection = this.settings.chart = selectChart
    this.chartNameTarget.textContent = this.getChartName(selectChart)
    this.chartTitleNameTarget.textContent = this.chartNameTarget.textContent
    this.customLimits = null
    this.chartWrapperTarget.classList.add('loading')
    if (isScaleDisabled(selection)) {
      this.hideMultiTargets(this.scaleSelectorTargets)
      this.showMultiTargets(this.vSelectorTargets)
    } else {
      this.showMultiTargets(this.scaleSelectorTargets)
    }
    if (isModeEnabled(selection)) {
      this.showMultiTargets(this.modeSelectorTargets)
    } else {
      this.hideMultiTargets(this.modeSelectorTargets)
    }
    if (hasMultipleVisibility(selection)) {
      this.showMultiTargets(this.vSelectorTargets)
      this.updateVSelector(selection)
    } else {
      this.hideMultiTargets(this.vSelectorTargets)
    }
    if (useRange(selection)) {
      this.settings.range = this.selectedRange()
      rangeOption = this.settings.range
      this.showMultiTargets(this.rangeSelectorTargets)
    } else {
      this.settings.range = ''
      rangeOption = ''
      this.hideMultiTargets(this.rangeSelectorTargets)
    }
    if (selectedChart !== selection || this.settings.bin !== this.selectedBin() ||
      this.settings.axis !== this.selectedAxis() || this.settings.range !== this.selectedRange()) {
      let url = '/api/chart/' + selection
      if (usesWindowUnits(selection) && !usesHybridUnits(selection)) {
        this.hideMultiTargets(this.binSelectorTargets)
        this.settings.bin = 'window'
      } else {
        this.showMultiTargets(this.binSelectorTargets)
        this.settings.bin = this.selectedBin()
        const _this = this
        this.binSizeTargets.forEach(el => {
          if (_this.exitCond(el)) {
            return
          }
          if (el.dataset.option !== 'window') return
          if (usesHybridUnits(selection)) {
            el.classList.remove('d-hide')
          } else {
            el.classList.add('d-hide')
            if (this.settings.bin === 'window') {
              this.settings.bin = 'day'
              this.setActiveOptionBtn(this.settings.bin, this.binSizeTargets)
            }
          }
        })
      }
      url += `?bin=${this.settings.bin}`
      if (this.settings.range !== '') {
        url += `&range=${this.settings.range}`
      }
      this.settings.axis = this.selectedAxis()
      if (!this.settings.axis) this.settings.axis = 'time' // Set the default.
      url += `&axis=${this.settings.axis}`
      this.setActiveOptionBtn(this.settings.axis, this.axisOptionTargets)
      const chartResponse = await requestJSON(url)
      selectedChart = selection
      this.plotGraph(selection, chartResponse)
    } else {
      this.chartWrapperTarget.classList.remove('loading')
    }
  }

  getChartName (chartValue) {
    switch (chartValue) {
      case 'ticket-price':
        return 'Ticket Price'
      case 'ticket-pool-size':
        return 'Ticket Pool Size'
      case 'ticket-pool-value':
        return 'Ticket Pool Value'
      case 'stake-participation':
        return 'Stake Participation'
      case 'privacy-participation':
        return 'Privacy Participation'
      case 'missed-votes':
        return 'Missed Votes'
      case 'block-size':
        return 'Block Size'
      case 'blockchain-size':
        return 'Blockchain Size'
      case 'tx-count':
        return 'Transaction Count'
      case 'duration-btw-blocks':
        return 'Duration Between Blocks'
      case 'pow-difficulty':
        return 'PoW Difficulty'
      case 'chainwork':
        return 'Total Work'
      case 'hashrate':
        return 'Hashrate'
      case 'coin-supply':
        return 'Coin Supply'
      case 'fees':
        return 'Fees'
      default:
        return ''
    }
  }

  async validateZoom () {
    await animationFrame()
    this.chartWrapperTarget.classList.add('loading')
    await animationFrame()
    let oldLimits = this.limits || this.chartsView.xAxisExtremes()
    this.limits = this.chartsView.xAxisExtremes()
    const selected = this.selectedZoom()
    if (selected && !(selectedChart === 'privacy-participation' && selected === 'all')) {
      this.lastZoom = Zoom.validate(selected, this.limits,
        this.isTimeAxis() ? avgBlockTime : 1, this.isTimeAxis() ? 1 : avgBlockTime)
    } else {
      // if this is for the privacy-participation chart, then zoom to the beginning of the record
      if (selectedChart === 'privacy-participation') {
        this.limits = oldLimits = this.customLimits
        this.settings.zoom = Zoom.object(this.limits[0], this.limits[1])
      }
      this.lastZoom = Zoom.project(this.settings.zoom, oldLimits, this.limits)
    }
    if (this.lastZoom) {
      this.chartsView.updateOptions({
        dateWindow: [this.lastZoom.start, this.lastZoom.end]
      })
    }
    if (selected !== this.settings.zoom) {
      this._zoomCallback(this.lastZoom.start, this.lastZoom.end)
    }
    await animationFrame()
    this.chartWrapperTarget.classList.remove('loading')
    this.chartsView.updateOptions({
      zoomCallback: this.zoomCallback,
      drawCallback: this.drawCallback
    })
  }

  _zoomCallback (start, end) {
    this.lastZoom = Zoom.object(start, end)
    this.settings.zoom = Zoom.encode(this.lastZoom)
    if (!this.isHomepage) {
      this.query.replace(this.settings)
    }
    const ex = this.chartsView.xAxisExtremes()
    const option = Zoom.mapKey(this.settings.zoom, ex, this.isTimeAxis() ? 1 : avgBlockTime)
    this.setActiveOptionBtn(option, this.zoomOptionTargets)
    const axesData = axesToRestoreYRange(this.settings.chart,
      this.supportedYRange, this.chartsView.yAxisRanges())
    if (axesData) this.chartsView.updateOptions({ axes: axesData })
  }

  isTimeAxis () {
    return this.selectedAxis() === 'time'
  }

  _drawCallback (graph, first) {
    // update position of y1, y2 label
    if (isMobile()) {
      // get axes
      const axes = graph.getOption('axes')
      if (axes) {
        const y1label = this.chartsViewTarget.querySelector('.dygraph-label.dygraph-ylabel')
        const y2label = this.chartsViewTarget.querySelector('.dygraph-label.dygraph-y2label')
        if (y1label) {
          const yAxis = axes.y
          if (yAxis) {
            const yLabelWidth = yAxis.axisLabelWidth
            if (yLabelWidth) {
              y1label.style.top = (Number(yLabelWidth) + 5) + 'px'
            }
          }
        }
        if (y2label) {
          const y2Axis = axes.y2
          if (y2Axis) {
            const y2LabelWidth = y2Axis.axisLabelWidth
            if (y2LabelWidth) {
              y2label.style.top = (Number(y2LabelWidth) + 5) + 'px'
            }
          }
        }
      }
    }
    if (first) return
    const [start, end] = this.chartsView.xAxisRange()
    if (start === end) return
    if (this.lastZoom.start === start) return // only handle slide event.
    this._zoomCallback(start, end)
  }

  setZoom (e) {
    const target = e.srcElement || e.target
    let option
    if (!target) {
      const ex = this.chartsView.xAxisExtremes()
      option = Zoom.mapKey(e, ex, this.isTimeAxis() ? 1 : avgBlockTime)
    } else {
      option = target.dataset.option
    }
    this.setActiveOptionBtn(option, this.zoomOptionTargets)
    if (!target) return // Exit if running for the first time
    this.validateZoom()
  }

  setRange (e) {
    const target = e.srcElement || e.target
    const option = target ? target.dataset.option : e
    if (!option) return
    this.setActiveOptionBtn(option, this.rangeOptionTargets)
    if (!target) return // Exit if running for the first time.
    selectedChart = null // Force fetch
    this.selectChart()
  }

  setBin (e) {
    const target = e.srcElement || e.target
    const option = target ? target.dataset.option : e
    if (!option) return
    this.setActiveOptionBtn(option, this.binSizeTargets)
    // hide vSelector
    this.updateVSelector()
    if (!target) return // Exit if running for the first time.
    selectedChart = null // Force fetch
    this.selectChart()
  }

  setScale (e) {
    const target = e.srcElement || e.target
    const option = target ? target.dataset.option : e
    if (!option) return
    this.setActiveOptionBtn(option, this.scaleTypeTargets)
    if (!target) return // Exit if running for the first time.
    if (this.chartsView) {
      this.chartsView.updateOptions({ logscale: option === 'log' })
    }
    this.settings.scale = option
    if (!this.isHomepage) {
      this.query.replace(this.settings)
    }
  }

  setMode (e) {
    const target = e.srcElement || e.target
    const option = target ? target.dataset.option : e
    if (!option) return
    this.setActiveOptionBtn(option, this.modeOptionTargets)
    if (!target) return // Exit if running for the first time.
    if (this.chartsView) {
      this.chartsView.updateOptions({ stepPlot: option === 'stepped' })
    }
    this.settings.mode = option
    if (!this.isHomepage) {
      this.query.replace(this.settings)
    }
  }

  setAxis (e) {
    const target = e.srcElement || e.target
    const option = target ? target.dataset.option : e
    if (!option) return
    this.setActiveOptionBtn(option, this.axisOptionTargets)
    if (!target) return // Exit if running for the first time.
    this.settings.axis = null
    this.selectChart()
  }

  updateVSelector (chart) {
    if (!chart) {
      chart = this.getSelectedChart()
    }
    const that = this
    let showWrapper = false
    this.vSelectorItemTargets.forEach(el => {
      if (that.exitCond(el)) {
        return
      }
      let show = el.dataset.charts.indexOf(chart) > -1
      if (el.dataset.bin && el.dataset.bin.indexOf(that.selectedBin()) === -1) {
        show = false
      }
      if (show) {
        el.classList.remove('d-hide')
        showWrapper = true
      } else {
        el.classList.add('d-hide')
      }
    })
    if (showWrapper) {
      this.showMultiTargets(this.vSelectorTargets)
    } else {
      this.hideMultiTargets(this.vSelectorTargets)
    }
    this.setVisibilityFromSettings()
  }

  setVisibilityFromSettings () {
    const selectChart = this.getSelectedChart()
    switch (selectChart) {
      case 'ticket-price':
        if (this.visibility.length !== 2) {
          this.visibility = [true, this.getTargetsChecked(this.ticketsPurchaseTargets)]
        }
        this.setTargetsChecked(this.ticketsPriceTargets, this.visibility[0])
        this.setTargetsChecked(this.ticketsPurchaseTargets, this.visibility[1])
        break
      case 'coin-supply':
        if (this.visibility.length !== 3) {
          this.visibility = [true, true, this.getTargetsChecked(this.anonymitySetTargets)]
        }
        this.setTargetsChecked(this.anonymitySetTargets, this.visibility[2])
        break
      case 'privacy-participation':
        if (this.visibility.length !== 2) {
          this.visibility = [true, this.getTargetsChecked(this.anonymitySetTargets)]
        }
        this.setTargetsChecked(this.anonymitySetTargets, this.visibility[1])
        break
      default:
        return
    }
    this.settings.visibility = this.visibility.join('-')
    if (!this.isHomepage) {
      this.query.replace(this.settings)
    }
  }

  setVisibility (e) {
    const selectChart = this.getSelectedChart()
    switch (selectChart) {
      case 'ticket-price':
      {
        const ticketPriceChecked = this.getTargetsChecked(this.ticketsPriceTargets)
        const ticketPurchaseChecked = this.getTargetsChecked(this.ticketsPurchaseTargets)
        if (!ticketPriceChecked && !ticketPurchaseChecked) {
          e.currentTarget.checked = true
          return
        }
        this.visibility = [ticketPriceChecked, ticketPurchaseChecked]
        break
      }
      case 'coin-supply':
        this.visibility = [true, true, this.getTargetsChecked(this.anonymitySetTargets)]
        break
      case 'privacy-participation':
        this.visibility = [true, this.getTargetsChecked(this.anonymitySetTargets)]
        break
      default:
        return
    }
    this.chartsView.updateOptions({ visibility: this.visibility })
    this.settings.visibility = this.visibility.join('-')
    if (!this.isHomepage) {
      this.query.replace(this.settings)
    }
  }

  setActiveOptionBtn (opt, optTargets) {
    const _this = this
    optTargets.forEach(li => {
      if (_this.exitCond(li)) {
        return
      }
      if (li.dataset.option === opt) {
        li.classList.add('active')
      } else {
        li.classList.remove('active')
      }
    })
  }

  selectedZoom () { return this.selectedOption(this.zoomOptionTargets) }
  selectedBin () { return this.selectedOption(this.binSizeTargets) }
  selectedScale () { return this.selectedOption(this.scaleTypeTargets) }
  selectedAxis () { return this.selectedNormalOption(this.axisOptionTargets) }
  selectedRange () { return this.selectedOption(this.rangeOptionTargets) }

  selectedOption (optTargets) {
    let key = false
    const _this = this
    optTargets.forEach((el) => {
      if (_this.exitCond(el)) return
      if (el.classList.contains('active')) key = el.dataset.option
    })
    return key
  }

  selectedNormalOption (optTargets) {
    let key = false
    optTargets.forEach((el) => {
      if (el.classList.contains('active')) key = el.dataset.option
    })
    return key
  }

  hideMultiTargets (opts) {
    opts.forEach((opt) => {
      opt.classList.add('d-hide')
    })
  }

  exitCond (opt) {
    return (isMobile() && !opt.classList.contains('mobile-mode')) || (!isMobile() && opt.classList.contains('mobile-mode'))
  }

  showMultiTargets (opts) {
    opts.forEach((opt) => {
      if ((isMobile() && !opt.classList.contains('mobile-mode')) || (!isMobile() && opt.classList.contains('mobile-mode'))) {
        opt.classList.add('d-hide')
      } else {
        opt.classList.remove('d-hide')
        opt.classList.remove('d-none')
      }
    })
  }

  getSelectedChart () {
    let selected = 'ticket-price'
    const _this = this
    this.chartSelectTargets.forEach((chart) => {
      if (_this.exitCond(chart)) {
        return
      }
      selected = chart.value
    })
    return selected
  }

  setSelectedChart (select) {
    const _this = this
    this.chartSelectTargets.forEach((chart) => {
      if (_this.exitCond(chart)) {
        return
      }
      chart.value = select
    })
  }

  getTargetsChecked (targets) {
    const _this = this
    let checked = false
    targets.forEach((target) => {
      if (_this.exitCond(target)) {
        return
      }
      checked = target.checked
    })
    return checked
  }

  setTargetsChecked (targets, checked) {
    const _this = this
    targets.forEach((target) => {
      if (_this.exitCond(target)) {
        return
      }
      target.checked = checked
    })
  }
}
