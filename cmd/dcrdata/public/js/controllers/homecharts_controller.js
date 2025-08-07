import { Controller } from '@hotwired/stimulus'
import dompurify from 'dompurify'
import { assign, map, merge } from 'lodash-es'
import { animationFrame } from '../helpers/animation_helper.js'
import { isEqual } from '../helpers/chart_helper.js'
import { requestJSON } from '../helpers/http.js'
import humanize from '../helpers/humanize_helper.js'
import { getDefault } from '../helpers/module_helper.js'
import TurboQuery from '../helpers/turbolinks_helper.js'
import Zoom from '../helpers/zoom_helper.js'
import globalEventBus from '../services/event_bus_service.js'
import { darkEnabled } from '../services/theme_service.js'

let selectedChart
let selectedType
let Dygraph // lazy loaded on connect

const aDay = 86400 * 1000 // in milliseconds
const aMonth = 30 // in days
const atomsToDCR = 1e-8
const windowScales = ['ticket-price', 'pow-difficulty', 'missed-votes']
const rangeUse = ['hashrate', 'pow-difficulty']
const hybridScales = ['privacy-participation']
const lineScales = ['ticket-price', 'privacy-participation']
const modeScales = ['ticket-price']
const multiYAxisChart = ['ticket-price', 'coin-supply', 'privacy-participation', 'avg-age-days', 'coin-days-destroyed', 'coin-age-bands', 'mean-coin-age', 'total-coin-days']
const coinAgeCharts = ['avg-age-days', 'coin-days-destroyed', 'coin-age-bands', 'mean-coin-age', 'total-coin-days']
const coinAgeBandsLabels = ['none', '>7Y', '5-7Y', '3-5Y', '2-3Y', '1-2Y', '6M-1Y', '1-6M', '1W-1M', '1D-1W', '<1D', 'Decred Price']
// const coinAgeBandsLabels = ['<1D', '1D-1W', '1W-1M', '1-6M', '6M-1Y', '1-2Y', '2-3Y', '3-5Y', '5-7Y', '>7Y', 'Decred Price']
const coinAgeBandsColors = [
  '#e9baa6',
  '#152b83',
  '#dc3912',
  '#ff9900',
  '#109618',
  '#990099',
  '#0099c6',
  '#dd4477',
  '#66aa00',
  '#b82e2e',
  '#576812ff',
  '#255595'
]
const decredChartOpts = ['ticket-price', 'ticket-pool-size', 'ticket-pool-value', 'stake-participation',
  'privacy-participation', 'missed-votes', 'block-size', 'blockchain-size', 'tx-count', 'duration-btw-blocks',
  'pow-difficulty', 'chainwork', 'hashrate', 'coin-supply', 'fees', 'avg-age-days', 'coin-days-destroyed',
  'coin-age-bands', 'mean-coin-age', 'total-coin-days']
const mutilchainChartOpts = ['block-size', 'blockchain-size', 'tx-count', 'tx-per-block', 'address-number',
  'pow-difficulty', 'hashrate', 'mined-blocks', 'mempool-size', 'mempool-txs', 'coin-supply', 'fees']
let globalChainType = ''
// index 0 represents y1 and 1 represents y2 axes.
const yValueRanges = { 'ticket-price': [1] }
const hashrateUnits = ['Th/s', 'Ph/s', 'Eh/s']
let ticketPoolSizeTarget, premine, stakeValHeight, stakeShare
let baseSubsidy, subsidyInterval, subsidyExponent, windowSize, avgBlockTime
let rawCoinSupply, rawPoolValue
let yFormatter, legendEntry, legendMarker, legendElement
const yAxisLabelWidth = {
  y1: {
    'ticket-price': 40,
    'ticket-pool-size': 40,
    'ticket-pool-value': 30,
    'stake-participation': 30,
    'privacy-participation': 40,
    'missed-votes': 30,
    'block-size': 45,
    'blockchain-size': 50,
    'tx-count': 45,
    'duration-btw-blocks': 40,
    'pow-difficulty': 40,
    chainwork: 35,
    hashrate: 50,
    'coin-supply': 30,
    fees: 50,
    'tx-per-block': 50,
    'address-number': 45,
    'mined-blocks': 40,
    'mempool-size': 40,
    'mempool-txs': 50,
    'avg-age-days': 50,
    'coin-days-destroyed': 50,
    'coin-age-bands': 30,
    'mean-coin-age': 50,
    'total-coin-days': 50
  },
  y2: {
    'ticket-price': 40,
    'avg-age-days': 30,
    'coin-days-destroyed': 30,
    'coin-age-bands': 30,
    'mean-coin-age': 30,
    'total-coin-days': 30
  }
}

function isMobile () {
  return window.innerWidth <= 768
}

function isCoinAgeChart (chart) {
  return coinAgeCharts.indexOf(chart) > -1
}

function hashrateTimePlotter (e) {
  hashrateLegendPlotter(e, 1693612800000)
}

function hashrateBlockPlotter (e) {
  hashrateLegendPlotter(e, 794429)
}

$(document).mouseup(function (e) {
  const selectArea = $('#chainChartSelectList')
  if (!selectArea.is(e.target) && selectArea.has(e.target).length === 0) {
    if (selectArea.css('display') !== 'none') {
      selectArea.css('display', 'none')
    }
  }
})

function makePt (x, y) { return { x, y } }

// Legend plotter processing for hashrate chart for blake3 algorithm transition
function hashrateLegendPlotter (e, midGapValue) {
  Dygraph.Plotters.fillPlotter(e)
  Dygraph.Plotters.linePlotter(e)
  const area = e.plotArea
  const ctx = e.drawingContext
  const mg = e.dygraph.toDomCoords(midGapValue, 0)
  const midGap = makePt(mg[0], mg[1])
  const fontSize = 13
  const dark = darkEnabled()
  ctx.textAlign = 'left'
  ctx.textBaseline = 'top'
  ctx.font = `${fontSize}px arial`
  ctx.lineWidth = 1
  ctx.strokeStyle = dark ? '#ffffff' : '#23562f'
  const boxColor = dark ? '#1e2b39' : '#ffffff'

  const line1 = 'Milestone'
  const line2 = '- Transition of the'
  const line3 = 'algorithm to BLAKE3'
  const line4 = '- Change block reward'
  const line5 = 'subsidy split to 1/89/10'
  let boxW = 0
  const txts = [line1, line2, line3, line4, line5]
  txts.forEach(txt => {
    const w = ctx.measureText(txt).width
    if (w > boxW) boxW = w
  })
  let rowHeight = fontSize * 1.5
  const rowPad = (rowHeight - fontSize) / 3
  const boxPad = rowHeight / 5
  let y = fontSize
  y += area.h / 4
  // Label the gap size.
  rowHeight -= 2 // just looks better
  ctx.fillStyle = boxColor
  const rect = makePt(midGap.x + boxPad, y - boxPad)
  const dims = makePt(boxW + boxPad * 3, rowHeight * 5 + boxPad * 2)
  ctx.fillRect(rect.x, rect.y, dims.x, dims.y)
  ctx.strokeRect(rect.x, rect.y, dims.x, dims.y)
  ctx.fillStyle = dark ? '#ffffff' : '#23562f'
  const centerX = midGap.x + boxW / 2 + 8
  const write = s => {
    const cornerX = centerX - (ctx.measureText(s).width / 2)
    ctx.fillText(s, cornerX + rowPad, y + rowPad)
    y += rowHeight
  }

  ctx.save()
  ctx.font = `bold ${fontSize + 2}px arial`
  write(line1)
  ctx.restore()
  write(line2)
  write(line3)
  write(line4)
  write(line5)
  // Draw a line from the box to the gap
  drawLine(ctx,
    makePt(midGap.x + boxW / 2, y),
    makePt(midGap.x, midGap.y - boxPad))
}

function drawLine (ctx, start, end) {
  ctx.beginPath()
  ctx.moveTo(start.x, start.y)
  ctx.lineTo(end.x, end.y)
  ctx.stroke()
}

function useRange (chart) {
  return rangeUse.indexOf(chart) > -1
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

function intComma (amount) {
  if (!amount) return ''
  return amount.toLocaleString(undefined, { maximumFractionDigits: 0 })
}

function zipWindowHvYZ (ys, zs, winSize, yMult, zMult, offset) {
  yMult = yMult || 1
  zMult = zMult || 1
  offset = offset || 0
  return ys.map((y, i) => {
    return [i * winSize + offset, y * yMult, zs[i] * zMult]
  })
}

function zipWindowTvYZ (times, ys, zs, yMult, zMult) {
  yMult = yMult || 1
  zMult = zMult || 1
  return times.map((t, i) => {
    return [new Date(t * 1000), ys[i] * yMult, zs[i] * zMult]
  })
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

// data coin age handler for bin = day, axis height
function zipCoinAgeHvY (heights, ys, zs, yMult, zMult, offset) {
  yMult = yMult || 1
  zMult = zMult || 1
  offset = offset || 1
  return ys.map((y, i) => {
    return [offset + heights[i], y * yMult, zs[i] * zMult]
  })
}

// data coin age handler for axis time
function zipCoinAgeTvY (times, ys, zs, yMult, zMult) {
  yMult = yMult || 1
  zMult = zMult || 1
  return times.map((t, i) => {
    return [new Date(t * 1000), ys[i] * yMult, zs[i] * zMult]
  })
}

// data coin age handler for bin = block, axis height
function zipCoinAgeIvY (ys, zs, yMult, zMult, offset) {
  yMult = yMult || 1
  zMult = zMult || 1
  offset = offset || 1 // TODO: check for why offset is set to a default value of 1 when genesis block has a height of 0
  return ys.map((y, i) => {
    return [offset + i, y * yMult, zs[i] * zMult]
  })
}

// data coin age bands handler for bin = day, axis height
function zipCoinAgeBandsHvY (heights, ys, zs, yMult, zMult, offset) {
  yMult = yMult || 1
  zMult = zMult || 1
  offset = offset || 1
  return ys.map((y, i) => {
    const less1Day = Number(y.less1Day)
    const dayToWeek = Number(y.dayToWeek)
    const weekToMonth = Number(y.weekToMonth)
    const monthToHalfYear = Number(y.monthToHalfYear)
    const halfYearToYear = Number(y.halfYearToYear)
    const yearTo2Year = Number(y.yearTo2Year)
    const twoYearTo3Year = Number(y.twoYearTo3Year)
    const threeYearTo5Year = Number(y.threeYearTo5Year)
    const fiveYearTo7Year = Number(y.fiveYearTo7Year)
    const greaterThan7Year = Number(y.greaterThan7Year)
    const totalValue = less1Day + dayToWeek + weekToMonth + monthToHalfYear + halfYearToYear + yearTo2Year +
      twoYearTo3Year + threeYearTo5Year + fiveYearTo7Year + greaterThan7Year
    // const less1DayPercent = (less1Day / totalValue) * 100
    const dayToWeekPercent = (dayToWeek / totalValue) * 100 + 0.00001
    const weekToMonthPercent = (weekToMonth / totalValue) * 100 + 0.00001
    const monthToHalfYearPercent = (monthToHalfYear / totalValue) * 100 + 0.00001
    const halfYearToYearPercent = (halfYearToYear / totalValue) * 100 + 0.00001
    const yearTo2YearPercent = (yearTo2Year / totalValue) * 100 + 0.00001
    const twoYearTo3YearPercent = (twoYearTo3Year / totalValue) * 100 + 0.00001
    const threeYearTo5YearPercent = (threeYearTo5Year / totalValue) * 100 + 0.00001
    const fiveYearTo7YearPercent = (fiveYearTo7Year / totalValue) * 100 + 0.00001
    const greaterThan7YearPercent = (greaterThan7Year / totalValue) * 100 + 0.00001
    const noneValue = 0.00001
    const less1DayPercent = 100 - dayToWeekPercent - weekToMonthPercent - monthToHalfYearPercent - halfYearToYearPercent -
      yearTo2YearPercent - twoYearTo3YearPercent - threeYearTo5YearPercent - fiveYearTo7YearPercent - greaterThan7YearPercent - noneValue
    return [
      offset + heights[i],
      noneValue,
      greaterThan7YearPercent * yMult,
      fiveYearTo7YearPercent * yMult,
      threeYearTo5YearPercent * yMult,
      twoYearTo3YearPercent * yMult,
      yearTo2YearPercent * yMult,
      halfYearToYearPercent * yMult,
      monthToHalfYearPercent * yMult,
      weekToMonthPercent * yMult,
      dayToWeekPercent * yMult,
      less1DayPercent * yMult,
      zs[i] * zMult]
  })
}

// data coin age bands handler for bin = block, axis height
function zipCoinAgeBandsIvY (ys, zs, yMult, zMult, offset) {
  yMult = yMult || 1
  zMult = zMult || 1
  offset = offset || 1 // TODO: check for why offset is set to a default value of 1 when genesis block has a height of 0
  return ys.map((y, i) => {
    const less1Day = Number(y.less1Day)
    const dayToWeek = Number(y.dayToWeek)
    const weekToMonth = Number(y.weekToMonth)
    const monthToHalfYear = Number(y.monthToHalfYear)
    const halfYearToYear = Number(y.halfYearToYear)
    const yearTo2Year = Number(y.yearTo2Year)
    const twoYearTo3Year = Number(y.twoYearTo3Year)
    const threeYearTo5Year = Number(y.threeYearTo5Year)
    const fiveYearTo7Year = Number(y.fiveYearTo7Year)
    const greaterThan7Year = Number(y.greaterThan7Year)
    const totalValue = less1Day + dayToWeek + weekToMonth + monthToHalfYear + halfYearToYear + yearTo2Year +
      twoYearTo3Year + threeYearTo5Year + fiveYearTo7Year + greaterThan7Year
    // const less1DayPercent = (less1Day / totalValue) * 100
    const dayToWeekPercent = (dayToWeek / totalValue) * 100 + 0.00001
    const weekToMonthPercent = (weekToMonth / totalValue) * 100 + 0.00001
    const monthToHalfYearPercent = (monthToHalfYear / totalValue) * 100 + 0.00001
    const halfYearToYearPercent = (halfYearToYear / totalValue) * 100 + 0.00001
    const yearTo2YearPercent = (yearTo2Year / totalValue) * 100 + 0.00001
    const twoYearTo3YearPercent = (twoYearTo3Year / totalValue) * 100 + 0.00001
    const threeYearTo5YearPercent = (threeYearTo5Year / totalValue) * 100 + 0.00001
    const fiveYearTo7YearPercent = (fiveYearTo7Year / totalValue) * 100 + 0.00001
    const greaterThan7YearPercent = (greaterThan7Year / totalValue) * 100 + 0.00001
    const noneValue = 0.00001
    const less1DayPercent = 100 - dayToWeekPercent - weekToMonthPercent - monthToHalfYearPercent - halfYearToYearPercent -
      yearTo2YearPercent - twoYearTo3YearPercent - threeYearTo5YearPercent - fiveYearTo7YearPercent - greaterThan7YearPercent - noneValue
    return [
      offset + i,
      noneValue,
      greaterThan7YearPercent * yMult,
      fiveYearTo7YearPercent * yMult,
      threeYearTo5YearPercent * yMult,
      twoYearTo3YearPercent * yMult,
      yearTo2YearPercent * yMult,
      halfYearToYearPercent * yMult,
      monthToHalfYearPercent * yMult,
      weekToMonthPercent * yMult,
      dayToWeekPercent * yMult,
      less1DayPercent * yMult,
      zs[i] * zMult]
  })
}

// data coin age bands handler for axis time
function zipCoinAgeBandsTvY (times, ys, zs, yMult, zMult) {
  yMult = yMult || 1
  zMult = zMult || 1
  return times.map((t, i) => {
    const y = ys[i]
    const less1Day = Number(y.less1Day)
    const dayToWeek = Number(y.dayToWeek)
    const weekToMonth = Number(y.weekToMonth)
    const monthToHalfYear = Number(y.monthToHalfYear)
    const halfYearToYear = Number(y.halfYearToYear)
    const yearTo2Year = Number(y.yearTo2Year)
    const twoYearTo3Year = Number(y.twoYearTo3Year)
    const threeYearTo5Year = Number(y.threeYearTo5Year)
    const fiveYearTo7Year = Number(y.fiveYearTo7Year)
    const greaterThan7Year = Number(y.greaterThan7Year)
    const totalValue = less1Day + dayToWeek + weekToMonth + monthToHalfYear + halfYearToYear + yearTo2Year +
      twoYearTo3Year + threeYearTo5Year + fiveYearTo7Year + greaterThan7Year
    // const less1DayPercent = (less1Day / totalValue) * 100
    const dayToWeekPercent = (dayToWeek / totalValue) * 100 + 0.00001
    const weekToMonthPercent = (weekToMonth / totalValue) * 100 + 0.00001
    const monthToHalfYearPercent = (monthToHalfYear / totalValue) * 100 + 0.00001
    const halfYearToYearPercent = (halfYearToYear / totalValue) * 100 + 0.00001
    const yearTo2YearPercent = (yearTo2Year / totalValue) * 100 + 0.00001
    const twoYearTo3YearPercent = (twoYearTo3Year / totalValue) * 100 + 0.00001
    const threeYearTo5YearPercent = (threeYearTo5Year / totalValue) * 100 + 0.00001
    const fiveYearTo7YearPercent = (fiveYearTo7Year / totalValue) * 100 + 0.00001
    const greaterThan7YearPercent = (greaterThan7Year / totalValue) * 100 + 0.00001
    const noneValue = 0.00001
    const less1DayPercent = 100 - dayToWeekPercent - weekToMonthPercent - monthToHalfYearPercent - halfYearToYearPercent -
      yearTo2YearPercent - twoYearTo3YearPercent - threeYearTo5YearPercent - fiveYearTo7YearPercent - greaterThan7YearPercent - noneValue
    return [
      new Date(t * 1000),
      noneValue,
      greaterThan7YearPercent * yMult,
      fiveYearTo7YearPercent * yMult,
      threeYearTo5YearPercent * yMult,
      twoYearTo3YearPercent * yMult,
      yearTo2YearPercent * yMult,
      halfYearToYearPercent * yMult,
      monthToHalfYearPercent * yMult,
      weekToMonthPercent * yMult,
      dayToWeekPercent * yMult,
      less1DayPercent * yMult,
      zs[i] * zMult]
  })
}

// handler func fo avg age days
function avgAgeDaysFunc (data) {
  if (data.axis === 'height') {
    if (data.bin === 'block') {
      return zipCoinAgeIvY(data.avgAge, data.marketPrice)
    } else {
      return zipCoinAgeHvY(data.h, data.avgAge, data.marketPrice)
    }
  } else {
    return zipCoinAgeTvY(data.t, data.avgAge, data.marketPrice)
  }
}

// handler func for coin day destroyed
function avgCoinDayDestroyedFunc (data) {
  if (data.axis === 'height') {
    if (data.bin === 'block') {
      return zipCoinAgeIvY(data.cdd, data.marketPrice)
    } else {
      return zipCoinAgeHvY(data.h, data.cdd, data.marketPrice)
    }
  } else {
    return zipCoinAgeTvY(data.t, data.cdd, data.marketPrice)
  }
}

// handler func for coin age bands
function coindAgeBandsFunc (data) {
  if (data.axis === 'height') {
    if (data.bin === 'block') {
      return zipCoinAgeBandsIvY(data.ageBands, data.marketPrice)
    } else {
      return zipCoinAgeBandsHvY(data.h, data.ageBands, data.marketPrice)
    }
  } else {
    return zipCoinAgeBandsTvY(data.t, data.ageBands, data.marketPrice)
  }
}

// handler func for mean coin age
function meanCoinAgeFunc (data) {
  if (data.axis === 'height') {
    if (data.bin === 'block') {
      return zipCoinAgeIvY(data.meanCoinAge, data.marketPrice)
    } else {
      return zipCoinAgeHvY(data.h, data.meanCoinAge, data.marketPrice)
    }
  } else {
    return zipCoinAgeTvY(data.t, data.meanCoinAge, data.marketPrice)
  }
}

// handler func for total coin days (SUM coin age)
function totalCoinDaysFunc (data) {
  if (data.axis === 'height') {
    if (data.bin === 'block') {
      return zipCoinAgeIvY(data.totalCoinDays, data.marketPrice)
    } else {
      return zipCoinAgeHvY(data.h, data.totalCoinDays, data.marketPrice)
    }
  } else {
    return zipCoinAgeTvY(data.t, data.totalCoinDays, data.marketPrice)
  }
}

function zipWindowHvY (ys, winSize, yMult, offset) {
  yMult = yMult || 1
  offset = offset || 0
  return ys.map((y, i) => {
    return [i * winSize + offset, y * yMult]
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
    return [xFunc(i), supplies[i] * atomsToDCR, null, 0]
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
      'binSize',
      'legendEntry',
      'legendMarker',
      'modeSelector',
      'modeOption',
      'rawDataURL',
      'chartName',
      'chartTitleName',
      'chainTypeSelected',
      'vSelectorItem',
      'vSelector',
      'ticketsPurchase',
      'anonymitySet',
      'ticketsPrice',
      'rangeSelector',
      'rangeOption',
      'marketPrice'
    ]
  }

  async connect () {
    this.isHomepage = !window.location.href.includes('/charts')
    this.query = new TurboQuery()
    premine = parseInt(this.data.get('premine'))
    stakeValHeight = parseInt(this.data.get('svh'))
    stakeShare = parseInt(this.data.get('pos')) / 10.0
    baseSubsidy = parseInt(this.data.get('bs'))
    subsidyInterval = parseInt(this.data.get('sri'))
    subsidyExponent = parseFloat(this.data.get('mulSubsidy')) / parseFloat(this.data.get('divSubsidy'))
    this.chainType = 'btc'
    avgBlockTime = parseInt(this.data.get(this.chainType + 'BlockTime')) * 1000
    globalChainType = this.chainType
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

    this.settings = TurboQuery.nullTemplate(['chart', 'zoom', 'scale', 'bin', 'axis', 'visibility', 'home', 'range'])
    if (!this.isHomepage) {
      this.query.update(this.settings)
    }
    this.binButtons = this.binSelectorTarget.querySelectorAll('button')
    this.scaleButtons = this.scaleSelectorTarget.querySelectorAll('button')
    this.modeButtons = this.modeSelectorTarget.querySelectorAll('button')
    this.initForChainChartChainTypeSelector()
    this.zoomCallback = this._zoomCallback.bind(this)
    this.drawCallback = this._drawCallback.bind(this)
    this.limits = null
    this.lastZoom = null
    this.visibility = []
    const _this = this
    this.setRange(this.settings.range ? this.settings.range : 'after')
    if (this.settings.visibility) {
      this.settings.visibility.split('-', -1).forEach(s => {
        _this.visibility.push(s === 'true')
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

  initForChainChartChainTypeSelector () {
    const chainArray = []
    const chainIconArray = []
    const chainNameArr = []
    $('.chain-chart-vodiapicker option').each(function () {
      const img = $(this).attr('data-thumbnail')
      const text = this.innerText
      const value = $(this).val()
      const item = `<li><img src="${img}" alt="" value="${value}"/><span>${text}</span></li>`
      chainArray.push(item)
      chainIconArray.push(`<li class="d-flex ai-center"><img src="${img}" alt="" value="${value}"/><span>${text}</span>
        <span class="dropdown-arrow" style="margin-left: 0.5rem;">
        <svg width="8" height="5" viewBox="0 0 10 6" xmlns="http://www.w3.org/2000/svg" fill="currentColor">
          <path d="M0 0L5 6L10 0H0Z" />
        </svg>
      </span>
        </li>`)
      chainNameArr.push(value)
    })
    $('#chainChartSelectUl').html(chainArray)
    const chainIndex = chainNameArr.indexOf(this.chainType)
    if (chainIndex >= 0) {
      $('.chain-chart-selected-btn').html(chainIconArray[chainIndex])
      $('.chain-chart-selected-btn').attr('value', this.chainType)
    }
    const _this = this
    $('#chainChartSelectUl li').click(function () {
      const value = $(this).find('img').attr('value')
      if (value === _this.chainType) {
        _this.toggleSelection('.chain-chart-selection-area')
        return
      }
      _this.chainTypeSelectedTarget.value = value
      _this.chainTypeChange()
      const img = $(this).find('img').attr('src')
      const text = this.innerText
      const item = `<li class="d-flex ai-center"><img src="${img}" alt=""/><span class="ms-1">${text}</span>
      <span class="dropdown-arrow" style="margin-left: 0.5rem;">
        <svg width="8" height="5" viewBox="0 0 10 6" xmlns="http://www.w3.org/2000/svg" fill="currentColor">
          <path d="M0 0L5 6L10 0H0Z" />
        </svg>
      </span>
      </li>`
      $('.chain-chart-selected-btn').html(item)
      $('.chain-chart-selected-btn').attr('value', value)
      _this.toggleSelection('.chain-chart-selection-area')
    })
    $('.chain-chart-selected-btn').click(function () {
      _this.toggleSelection('.chain-chart-selection-area')
    })
    this.settings.chart = this.settings.chart || (this.chainType === 'dcr' ? 'ticket-price' : 'block-size')
    this.chartSelectTarget.innerHTML = this.chainType === 'dcr' ? this.getDecredChartOptsHtml() : this.getMutilchainChartOptsHtml()
    this.chartSelectTarget.value = this.settings.chart
    this.handlerChainChartHeaderLink()
    this.setDisplayChainChartFooter()
  }

  handlerChainChartHeaderLink () {
    const chartHeader = document.getElementById('chainChartHeader')
    const chain = this.chainType
    const chart = this.settings.chart
    let link = chain === 'dcr' ? '/decred/charts' : `/${chain}/charts`
    link += `?chart=${chart}`
    chartHeader.href = link
  }

  setDisplayChainChartFooter () {
    const chain = this.chainType
    if (chain === 'dcr') {
      $('#chainChartFooterRow').removeClass('d-hide')
    } else {
      $('#chainChartFooterRow').addClass('d-hide')
      this.settings.axis = 'time'
      this.settings.bin = 'day'
      this.setActiveOptionBtn(this.settings.axis, this.axisOptionTargets)
      this.setActiveToggleBtn(this.settings.bin, this.binButtons)
    }
  }

  toggleSelection (selector) {
    const target = $(selector)
    if (target.css('display') === 'none') {
      target.show()
    } else {
      target.hide()
    }
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

  setVisibility (e) {
    switch (this.chartSelectTarget.value) {
      case 'ticket-price':
        if (!this.ticketsPriceTarget.checked && !this.ticketsPurchaseTarget.checked) {
          e.currentTarget.checked = true
          return
        }
        this.visibility = [this.ticketsPriceTarget.checked, this.ticketsPurchaseTarget.checked]
        break
      case 'coin-supply':
        this.visibility = [true, true, this.anonymitySetTarget.checked]
        break
      case 'privacy-participation':
        this.visibility = [true, this.anonymitySetTarget.checked]
        break
      case 'avg-age-days':
      case 'coin-days-destroyed':
      case 'coin-age-bands':
      case 'mean-coin-age':
      case 'total-coin-days':
        this.visibility = [true, this.marketPriceTarget.checked]
        break
      default:
        return
    }
    this.chartsView.updateOptions({ visibility: this.getVisibilityForCharts(this.chartSelectTarget.value, this.visibility) })
    this.settings.visibility = this.visibility.join('-')
    if (!this.isHomepage) {
      this.query.replace(this.settings)
    }
  }

  getVisibilityForCharts (chart, visibility) {
    if (chart !== 'coin-age-bands') {
      return visibility
    }
    const stackVisibility = []
    coinAgeBandsColors.forEach((item) => {
      stackVisibility.push(true)
    })
    stackVisibility[stackVisibility.length - 1] = visibility[1]
    return stackVisibility
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
    this.chartSelectTarget.value = this.settings.chart

    if (this.settings.axis) this.setAxis(this.settings.axis) // set first
    if (this.settings.scale === 'log') this.setSelectScale(this.settings.scale)
    if (this.settings.zoom) this.setInitSelectZoom(this.settings.zoom)
    this.setSelectBin(this.settings.bin ? this.settings.bin : 'day')
    this.setSelectMode(this.settings.mode ? this.settings.mode : 'smooth')

    const ogLegendGenerator = Dygraph.Plugins.Legend.generateLegendHTML
    Dygraph.Plugins.Legend.generateLegendHTML = (g, x, pts, w, row) => {
      g.updateOptions({ legendIndex: row }, true)
      return ogLegendGenerator(g, x, pts, w, row)
    }
    this.selectChart()
  }

  plotGraph (chartName, data) {
    let d = []
    let gOptions = {
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
      plotter: null,
      fillGraph: false,
      stackedGraph: false
    }
    rawPoolValue = []
    rawCoinSupply = []
    const labels = []
    const stackVisibility = []
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
        this.visibility = [this.ticketsPriceTarget.checked, this.ticketsPurchaseTarget.checked]
        gOptions.visibility = this.visibility
        gOptions.axes.y2 = {
          valueRange: [0, windowSize * 20 * 8],
          axisLabelFormatter: (y) => Math.round(y),
          axisLabelWidth: isMobile() ? yAxisLabelWidth.y2['ticket-price'] : yAxisLabelWidth.y2['ticket-price']
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
        assign(gOptions, mapDygraphOptions(d, [xlabel, 'Total Transactions'], false,
          'Total Transactions', false, false))
        break
      case 'tx-per-block': // tx per block graph
        d = zip2D(data, data.count)
        assign(gOptions, mapDygraphOptions(d, [xlabel, 'Avg TXs Per Block'], false,
          'Avg TXs Per Block', false, false))
        break
      case 'mined-blocks': // tx per block graph
        d = zip2D(data, data.count)
        assign(gOptions, mapDygraphOptions(d, [xlabel, 'Mined Blocks'], false,
          'Mined Blocks', false, false))
        break
      case 'mempool-txs': // tx per block graph
        d = zip2D(data, data.count)
        assign(gOptions, mapDygraphOptions(d, [xlabel, 'Mempool Transactions'], false,
          'Mempool Transactions', false, false))
        break
      case 'mempool-size': // blockchain size graph
        d = zip2D(data, data.size)
        assign(gOptions, mapDygraphOptions(d, [xlabel, 'Mempool Size'], true,
          'Mempool Size', false, true))
        break
      case 'address-number': // tx per block graph
        d = zip2D(data, data.count)
        assign(gOptions, mapDygraphOptions(d, [xlabel, 'Active Addresses'], false,
          'Active Addresses', false, false))
        break
      case 'pow-difficulty': // difficulty graph
        d = powDiffFunc(data)
        assign(gOptions, mapDygraphOptions(d, [xlabel, 'Difficulty'], true, 'Difficulty', true, false))
        if (_this.settings.range !== 'before' && _this.settings.range !== 'after') {
          gOptions.plotter = _this.settings.axis === 'height' ? hashrateBlockPlotter : hashrateTimePlotter
        }
        break
      case 'coin-supply': // supply graph
        if (this.settings.bin === 'day') {
          d = zip2D(data, data.supply)
          assign(gOptions, mapDygraphOptions(d, [xlabel, 'Coins Supply'], false,
            'Coins Supply', false, false))
          break
        }
        d = circulationFunc(data)
        assign(gOptions, mapDygraphOptions(d.data, [xlabel, 'Coin Supply', 'Inflation Limit', 'Mix Rate'],
          true, 'Coin Supply (' + this.chainType.toUpperCase() + ')', true, false))
        gOptions.y2label = 'Inflation Limit'
        gOptions.y3label = 'Mix Rate'
        gOptions.series = { 'Inflation Limit': { axis: 'y2' }, 'Mix Rate': { axis: 'y3' } }
        this.visibility = [true, true, this.anonymitySetTarget.checked]
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
          addLegendEntryFmt(div, data.series[0], y => intComma(y) + ' ' + globalChainType.toUpperCase())
          let change = 0
          if (i < d.inflation.length) {
            if (selectedType === 'dcr') {
              const supply = data.series[0].y
              if (this.anonymitySetTarget.checked) {
                const mixed = data.series[2].y
                const mixedPercentage = ((mixed / supply) * 100).toFixed(2)
                div.appendChild(legendEntry(`${legendMarker()} Mixed: ${intComma(mixed)} DCR (${mixedPercentage}%)`))
              }
            }
            const predicted = d.inflation[i]
            const unminted = predicted - data.series[0].y
            change = ((unminted / predicted) * 100).toFixed(2)
            div.appendChild(legendEntry(`${legendMarker()} Unminted: ${intComma(unminted)} ` + globalChainType.toUpperCase() + ` (${change}%)`))
          }
        }
        break

      case 'fees': // block fee graph
        d = zip2D(data, data.fees, atomsToDCR)
        assign(gOptions, mapDygraphOptions(d, [xlabel, 'Total Fee'], false, 'Total Fee (' + globalChainType.toUpperCase() + ')', true, false))
        yFormatter = customYFormatter(y => y.toFixed(8) + ' ' + globalChainType.toUpperCase())
        break

      case 'duration-btw-blocks': // Duration between blocks graph
        d = zip2D(data, data.duration, 1, 1)
        assign(gOptions, mapDygraphOptions(d, [xlabel, 'Duration Between Blocks'], false,
          'Duration Between Blocks (seconds)', false, false))
        break

      case 'hashrate': // Total chainwork over time
        d = this.chainType === 'dcr' ? (isHeightBlock ? zipHvY(data.h, data.rate, 1e-3, data.offset) : zip2D(data, data.rate, 1e-3, data.offset)) : zip2D(data, data.rate, 1e-3, data.offset)
        assign(gOptions, mapDygraphOptions(d, [xlabel, 'Network Hashrate'],
          false, 'Network Hashrate (petahash/s)', true, false))
        yFormatter = customYFormatter(y => withBigUnits(y * 1e3, hashrateUnits))
        if (_this.settings.range !== 'before' && _this.settings.range !== 'after') {
          gOptions.plotter = _this.settings.axis === 'height' ? hashrateBlockPlotter : hashrateTimePlotter
        }
        break

      case 'avg-age-days':
        d = avgAgeDaysFunc(data)
        assign(gOptions, mapDygraphOptions(d, [xlabel, 'Average Age Days', 'Decred Price'], true,
          'Average Age Days (days)', true, false))
        gOptions.y2label = 'Decred Price (USD)'
        gOptions.series = { 'Decred Price': { axis: 'y2' } }
        this.visibility = [true, this.marketPriceTarget.checked]
        gOptions.visibility = this.visibility
        gOptions.axes.y2 = {
          valueRange: [0, 300],
          axisLabelFormatter: (y) => Math.round(y),
          axisLabelWidth: isMobile() ? yAxisLabelWidth.y2['avg-age-days'] : yAxisLabelWidth.y2['avg-age-days'] + 15
        }
        yFormatter = (div, data, i) => {
          addLegendEntryFmt(div, data.series[0], y => y.toFixed(2) + ' days')
          addLegendEntryFmt(div, data.series[1], y => (y > 0 ? humanize.formatNumber(y, 2, true) : '0') + ' USD')
        }
        break

      case 'coin-days-destroyed':
        d = avgCoinDayDestroyedFunc(data)
        assign(gOptions, mapDygraphOptions(d, [xlabel, 'Coin Days Destroyed', 'Decred Price'], true,
          'Coin Days Destroyed (coin-days)', true, false))
        gOptions.y2label = 'Decred Price (USD)'
        gOptions.series = { 'Decred Price': { axis: 'y2' } }
        this.visibility = [true, this.marketPriceTarget.checked]
        gOptions.visibility = this.visibility
        gOptions.axes.y2 = {
          valueRange: [0, 300],
          axisLabelFormatter: (y) => Math.round(y),
          axisLabelWidth: isMobile() ? yAxisLabelWidth.y2['coin-days-destroyed'] : yAxisLabelWidth.y2['coin-days-destroyed'] + 15
        }
        yFormatter = (div, data, i) => {
          addLegendEntryFmt(div, data.series[0], y => humanize.formatNumber(y, 2, true) + ' coin-days')
          addLegendEntryFmt(div, data.series[1], y => (y > 0 ? humanize.formatNumber(y, 2, true) : '0') + ' USD')
        }
        break

      case 'mean-coin-age':
        d = meanCoinAgeFunc(data)
        assign(gOptions, mapDygraphOptions(d, [xlabel, 'Mean Coin Age', 'Decred Price'], true,
          'Mean Coin Age (days)', true, false))
        gOptions.y2label = 'Decred Price (USD)'
        gOptions.series = { 'Decred Price': { axis: 'y2' } }
        this.visibility = [true, this.marketPriceTarget.checked]
        gOptions.visibility = this.visibility
        gOptions.axes.y2 = {
          valueRange: [0, 300],
          axisLabelFormatter: (y) => Math.round(y),
          axisLabelWidth: isMobile() ? yAxisLabelWidth.y2['mean-coin-age'] : yAxisLabelWidth.y2['mean-coin-age'] + 15
        }
        yFormatter = (div, data, i) => {
          addLegendEntryFmt(div, data.series[0], y => humanize.formatNumber(y, 2, true) + ' days')
          addLegendEntryFmt(div, data.series[1], y => (y > 0 ? humanize.formatNumber(y, 2, true) : '0') + ' USD')
        }
        break

      case 'total-coin-days':
        d = totalCoinDaysFunc(data)
        assign(gOptions, mapDygraphOptions(d, [xlabel, 'Total Coin Days', 'Decred Price'], true,
          'Total Coin Days (days)', true, false))
        gOptions.y2label = 'Decred Price (USD)'
        gOptions.series = { 'Decred Price': { axis: 'y2' } }
        this.visibility = [true, this.marketPriceTarget.checked]
        gOptions.visibility = this.visibility
        gOptions.axes.y2 = {
          valueRange: [0, 300],
          axisLabelFormatter: (y) => Math.round(y),
          axisLabelWidth: isMobile() ? yAxisLabelWidth.y2['total-coin-days'] : yAxisLabelWidth.y2['total-coin-days'] + 15
        }
        yFormatter = (div, data, i) => {
          addLegendEntryFmt(div, data.series[0], y => humanize.formatNumber(y, 2, true) + ' coin-days')
          addLegendEntryFmt(div, data.series[1], y => (y > 0 ? humanize.formatNumber(y, 2, true) : '0') + ' USD')
        }
        break

      case 'coin-age-bands':
        d = coindAgeBandsFunc(data)
        labels.push(xlabel)
        labels.push(...coinAgeBandsLabels)
        this.visibility = [true, this.marketPriceTarget.checked]
        coinAgeBandsColors.forEach((item) => {
          stackVisibility.push(true)
        })
        stackVisibility[stackVisibility.length - 1] = this.visibility[1]
        gOptions = {
          labels: labels,
          file: d,
          colors: coinAgeBandsColors,
          ylabel: 'HODL Wave (%)',
          y2label: 'Decred Price (USD)',
          valueRange: [0, 100],
          fillGraph: true,
          stackedGraph: true,
          visibility: stackVisibility,
          series: {
            none: { fillGraph: true },
            '>7Y': { fillGraph: true },
            '5-7Y': { fillGraph: true },
            '3-5Y': { fillGraph: true },
            '2-3Y': { fillGraph: true },
            '1-2Y': { fillGraph: true },
            '6M-1Y': { fillGraph: true },
            '1-6M': { fillGraph: true },
            '1W-1M': { fillGraph: true },
            '1D-1W': { fillGraph: true },
            '<1D': { fillGraph: true },
            'Decred Price': {
              axis: 'y2',
              strokeWidth: 1,
              fillGraph: false
            }
          },
          legend: 'always',
          includeZero: true,
          // zoomCallback: this.depthZoomCallback,
          axes: {
            y2: {
              valueRange: [0, 300],
              axisLabelFormatter: (y) => Math.round(y),
              axisLabelWidth: isMobile() ? yAxisLabelWidth.y2['coin-age-bands'] : yAxisLabelWidth.y2['coin-age-bands'] + 15
            }
          }
        }
        yFormatter = (div, data, i) => {
          const insideLegendDiv = document.createElement('div')
          const line1LegendDiv = document.createElement('div')
          const line2LegendDiv = document.createElement('div')
          line1LegendDiv.classList.add('d-flex', 'align-items-center')
          line2LegendDiv.classList.add('d-flex', 'align-items-center')
          insideLegendDiv.classList.add('coin-age-band-data-area')
          data.series.forEach((serie, idx) => {
            if (idx === 0) {
              return
            }
            if (idx === data.series.length - 1) {
              addLegendEntryFmt(insideLegendDiv, serie, y => (y > 0 ? humanize.formatNumber(y, 2, true) : '0') + ' USD')
            } else {
              if (idx < 6) {
                addLegendEntryFmt(line1LegendDiv, serie, y => (y > 0 ? humanize.formatNumber(y, 2, true) : '0') + ' %')
              } else {
                addLegendEntryFmt(line2LegendDiv, serie, y => (y > 0 ? humanize.formatNumber(y, 2, true) : '0') + ' %')
              }
            }
          })
          insideLegendDiv.appendChild(line1LegendDiv)
          insideLegendDiv.appendChild(line2LegendDiv)
          div.appendChild(insideLegendDiv)
        }
        break
    }
    gOptions.axes.y = {
      axisLabelWidth: isMobile() ? yAxisLabelWidth.y1[chartName] : yAxisLabelWidth.y1[chartName] + 10
    }
    const baseURL = `${this.query.url.protocol}//${this.query.url.host}`
    this.rawDataURLTarget.textContent = this.chainType === 'dcr'
      ? `${baseURL}/api/chart/${chartName}?axis=${this.settings.axis}&bin=${this.settings.bin}`
      : `${baseURL}/api/chainchart/${this.chainType}/${chartName}?axis=${this.settings.axis}&bin=${this.settings.bin}`

    this.chartsView.plotter_.clear()
    this.chartsView.updateOptions(gOptions, false)
    if (yValueRanges[chartName]) this.supportedYRange = this.chartsView.yAxisRanges()
    this.validateZoom()
  }

  updateVSelector (chart) {
    if (!chart) {
      chart = this.chartSelectTarget.value
    }
    const that = this
    let showWrapper = false
    this.vSelectorItemTargets.forEach(el => {
      let show = el.dataset.charts.indexOf(chart) > -1
      if (el.dataset.bin && el.dataset.bin.indexOf(that.selectedBin()) === -1) {
        show = false
      }
      if (el.dataset.charts === 'coin-age' && isCoinAgeChart(chart)) {
        show = true
      }
      if (show) {
        el.classList.remove('d-hide')
        showWrapper = true
      } else {
        el.classList.add('d-hide')
      }
    })
    if (showWrapper) {
      this.vSelectorTarget.classList.remove('d-hide')
    } else {
      this.vSelectorTarget.classList.add('d-hide')
    }
    this.setVisibilityFromSettings()
  }

  async chainTypeChange () {
    // selected chain
    const chain = this.chainTypeSelectedTarget.value
    if (chain === this.chainType) {
      return
    }
    const _this = this
    let reinitChartType = false
    reinitChartType = this.chainType === 'dcr' || chain === 'dcr'
    this.chainType = chain
    // reinit
    if (reinitChartType) {
      this.chartSelectTarget.innerHTML = this.chainType === 'dcr' ? this.getDecredChartOptsHtml() : this.getMutilchainChartOptsHtml()
    }
    // determind select chart
    this.settings.chart = this.getSelectedChart()
    this.handlerChainChartHeaderLink()
    this.setDisplayChainChartFooter()
    this.chartNameTarget.textContent = this.getChartName(this.chartSelectTarget.value)
    this.chartTitleNameTarget.textContent = this.chartNameTarget.textContent
    this.customLimits = null
    this.chartWrapperTarget.classList.add('loading')
    if (isScaleDisabled(this.settings.chart)) {
      this.scaleSelectorTarget.classList.add('d-hide')
    } else {
      this.scaleSelectorTarget.classList.remove('d-hide')
    }
    if (isModeEnabled(this.settings.chart)) {
      this.modeSelectorTarget.classList.remove('d-hide')
    } else {
      this.modeSelectorTarget.classList.add('d-hide')
    }
    if (hasMultipleVisibility(this.settings.chart)) {
      this.vSelectorTarget.classList.remove('d-hide')
      this.updateVSelector(this.settings.chart)
    } else {
      this.vSelectorTarget.classList.add('d-hide')
    }
    if (useRange(this.settings.chart) && this.chainType === 'dcr') {
      this.settings.range = this.selectedRange()
      this.rangeSelectorTarget.classList.remove('d-hide')
    } else {
      this.settings.range = ''
      this.rangeSelectorTarget.classList.add('d-hide')
    }
    if (selectedType !== this.chainType || (selectedType === this.chainType && selectedChart !== this.settings.chart) ||
      this.settings.bin !== this.selectedBin() || this.settings.axis !== this.selectedAxis()) {
      let url = this.chainType === 'dcr' ? '/api/chart/' + this.settings.chart : `/api/chainchart/${this.chainType}/` + this.settings.chart
      if (usesWindowUnits(this.settings.chart) && !usesHybridUnits(this.settings.chart)) {
        this.binSelectorTarget.classList.add('d-hide')
        this.settings.bin = 'window'
      } else {
        this.settings.bin = this.selectedBin()
        if (this.chainType === 'dcr') {
          this.binSelectorTarget.classList.remove('d-hide')
          this.binButtons.forEach(btn => {
            if (btn.name !== 'window') return
            if (usesHybridUnits(_this.settings.chart)) {
              btn.classList.remove('d-hide')
            } else {
              btn.classList.add('d-hide')
              if (_this.settings.bin === 'window') {
                _this.settings.bin = 'day'
                _this.setActiveToggleBtn(_this.settings.bin, _this.binButtons)
              }
            }
          })
        } else {
          this.binSelectorTarget.classList.add('d-hide')
        }
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
      selectedType = this.chainType
      selectedChart = this.settings.chart
      this.plotGraph(this.settings.chart, chartResponse)
    } else {
      this.chartWrapperTarget.classList.remove('loading')
    }
  }

  getSelectedChart () {
    let hasChart = false
    const chartOpts = this.chainType === 'dcr' ? decredChartOpts : mutilchainChartOpts
    const _this = this
    chartOpts.forEach((opt) => {
      if (_this.settings.chart === opt) {
        hasChart = true
      }
    })
    if (hasChart) {
      this.chartSelectTarget.value = this.settings.chart
      return this.settings.chart
    }
    return chartOpts[0]
  }

  getDecredChartOptsHtml () {
    return `<optgroup label="Staking">
        <option value="ticket-price">Ticket Price</option>
        <option value="ticket-pool-size">Ticket Pool Size</option>
        <option value="ticket-pool-value">Ticket Pool Value</option>
        <option value="stake-participation">Stake Participation</option>
        <option value="privacy-participation">Privacy Participation</option>
        <option value="missed-votes">Missed Votes</option>
      </optgroup>
        <optgroup label="Chain">
        <option value="block-size">Block Size</option>
        <option value="blockchain-size">Blockchain Size</option>
        <option value="tx-count">Transaction Count</option>
        <option value="duration-btw-blocks">Duration Between Blocks</option>
      </optgroup>
      <optgroup label="Mining">
        <option value="pow-difficulty">PoW Difficulty</option>
        <option value="chainwork">Total Work</option>
        <option value="hashrate">Hashrate</option>
      </optgroup>
        <optgroup label="Distribution">
        <option value="coin-supply">Coin Supply</option>
        <option value="fees">Fees</option>
      </optgroup>
      </optgroup>
      <optgroup label="Coin Age">
        <option value="avg-age-days">Average Age Days</option>
        <option value="coin-days-destroyed">Coin Days Destroyed</option>
        <option value="coin-age-bands">HODL Age Bands</option>
        <option value="mean-coin-age">Mean Coin Age</option>
        <option value="total-coin-days">Total Coin Days</option>
      </optgroup>`
  }

  getMutilchainChartOptsHtml () {
    return '<optgroup label="Chain">' +
      '<option value="block-size">Block Size</option>' +
      '<option value="blockchain-size">Blockchain Size</option>' +
      '<option value="tx-count">Transaction Count</option>' +
      '<option value="tx-per-block">TXs Per Blocks</option>' +
      '<option value="address-number">Active Addresses</option>' +
      '</optgroup>' +
      '<optgroup label="Mining">' +
      '<option value="pow-difficulty">Difficulty</option>' +
      '<option value="hashrate">Hashrate</option>' +
      '<option value="mined-blocks">Mined Blocks</option>' +
      '<option value="mempool-size">Mempool Size</option>' +
      '<option value="mempool-txs">Mempool TXs</option>' +
      '</optgroup>' +
      '<optgroup label="Distribution">' +
      '<option value="coin-supply">Coin Supply</option>' +
      '<option value="fees">Fees</option>' +
      '</optgroup>'
  }

  async selectChart () {
    const selection = this.settings.chart = this.chartSelectTarget.value
    this.handlerChainChartHeaderLink()
    this.chartNameTarget.textContent = this.getChartName(this.chartSelectTarget.value)
    this.chartTitleNameTarget.textContent = this.chartNameTarget.textContent
    this.customLimits = null
    this.chartWrapperTarget.classList.add('loading')
    if (isScaleDisabled(selection)) {
      this.scaleSelectorTarget.classList.add('d-hide')
      this.vSelectorTarget.classList.remove('d-hide')
    } else {
      this.scaleSelectorTarget.classList.remove('d-hide')
    }
    if (isModeEnabled(selection)) {
      this.modeSelectorTarget.classList.remove('d-hide')
    } else {
      this.modeSelectorTarget.classList.add('d-hide')
    }
    if (hasMultipleVisibility(selection)) {
      this.vSelectorTarget.classList.remove('d-hide')
      this.updateVSelector(selection)
    } else {
      this.vSelectorTarget.classList.add('d-hide')
    }
    if (useRange(selection) && this.chainType === 'dcr') {
      this.settings.range = this.selectedRange()
      this.rangeSelectorTarget.classList.remove('d-hide')
    } else {
      this.settings.range = ''
      this.rangeSelectorTarget.classList.add('d-hide')
    }
    if (selectedChart !== selection || this.settings.bin !== this.selectedBin() ||
      this.settings.axis !== this.selectedAxis() || (this.chainType === 'dcr' && this.settings.range !== this.selectedRange())) {
      let url = this.chainType === 'dcr' ? '/api/chart/' + selection : `/api/chainchart/${this.chainType}/` + selection
      if (usesWindowUnits(selection) && !usesHybridUnits(selection)) {
        this.binSelectorTarget.classList.add('d-hide')
        this.settings.bin = 'window'
      } else {
        this.settings.bin = this.selectedBin()
        const _this = this
        if (this.chainType === 'dcr') {
          this.binSelectorTarget.classList.remove('d-hide')
          this.binButtons.forEach(btn => {
            if (btn.name !== 'window') return
            if (usesHybridUnits(selection)) {
              btn.classList.remove('d-hide')
            } else {
              btn.classList.add('d-hide')
              if (_this.settings.bin === 'window') {
                _this.settings.bin = 'day'
                _this.setActiveToggleBtn(_this.settings.bin, _this.binButtons)
              }
            }
          })
        } else {
          this.binSelectorTarget.classList.add('d-hide')
        }
      }
      url += `?bin=${this.settings.bin}`
      if (this.chainType === 'dcr' && this.settings.range !== '') {
        url += `&range=${this.settings.range}`
      }
      this.settings.axis = this.selectedAxis()
      if (!this.settings.axis) this.settings.axis = 'time' // Set the default.
      url += `&axis=${this.settings.axis}`
      this.setActiveOptionBtn(this.settings.axis, this.axisOptionTargets)
      const chartResponse = await requestJSON(url)
      selectedChart = selection
      selectedType = this.chainType
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
      case 'tx-per-block':
        return 'TXs Per Blocks'
      case 'mined-blocks':
        return 'Mined Blocks'
      case 'mempool-txs':
        return 'Mempool TXs'
      case 'mempool-size':
        return 'Mempool Size'
      case 'address-number':
        return 'Active Addresses'
      case 'avg-age-days':
        return 'Average Age Days'
      case 'coin-days-destroyed':
        return 'Coin Days Destroyed'
      case 'coin-age-bands':
        return 'HODL Age Bands'
      case 'mean-coin-age':
        return 'Mean Coin Age'
      case 'total-coin-days':
        return 'Total Coin Days'
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
    const selected = this.zoomSelectorTarget.value
    if (selected && this.isValidZoomSelect(selected) && !(selectedChart === 'privacy-participation' && selected === 'all')) {
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

  isValidZoomSelect (option) {
    return option === 'all' || option === 'year' || option === 'month' || option === 'week' || option === 'day'
  }

  _zoomCallback (start, end) {
    this.lastZoom = Zoom.object(start, end)
    this.settings.zoom = Zoom.encode(this.lastZoom)
    if (!this.isHomepage) {
      this.query.replace(this.settings)
    }
    const ex = this.chartsView.xAxisExtremes()
    const option = Zoom.mapKey(this.settings.zoom, ex, this.isTimeAxis() ? 1 : avgBlockTime)
    this.zoomSelectorTarget.value = option
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

  setInitSelectZoom (e) {
    const ex = this.chartsView.xAxisExtremes()
    const option = Zoom.mapKey(e, ex, this.isTimeAxis() ? 1 : avgBlockTime)
    this.zoomSelectorTarget.value = option
    if (!e.target) return // Exit if running for the first time\
    this.validateZoom()
  }

  setSelectZoom (e) {
    this.validateZoom()
  }

  setSelectBin (e) {
    const btn = e.target || e.srcElement
    if (!btn) {
      return
    }
    let option
    if (btn.nodeName === 'BUTTON') {
      option = btn.name
    }
    if (!option) {
      return
    }
    this.setActiveToggleBtn(option, this.binButtons)
    this.updateVSelector()
    selectedChart = null // Force fetch
    this.selectChart()
  }

  setSelectScale (e) {
    const btn = e.target || e.srcElement
    if (!btn) {
      return
    }
    let option
    if (btn.nodeName === 'BUTTON') {
      option = btn.name
    }
    if (!option) {
      return
    }
    this.setActiveToggleBtn(option, this.scaleButtons)
    if (this.chartsView) {
      this.chartsView.updateOptions({ logscale: option === 'log' })
    }
    this.settings.scale = option
    if (!this.isHomepage) {
      this.query.replace(this.settings)
    }
  }

  setSelectMode (e) {
    const btn = e.target || e.srcElement
    if (!btn) {
      return
    }
    let option
    if (btn.nodeName === 'BUTTON') {
      option = btn.name
    }
    if (!option) {
      return
    }
    this.setActiveToggleBtn(option, this.modeButtons)
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

  setVisibilityFromSettings () {
    switch (this.chartSelectTarget.value) {
      case 'ticket-price':
        if (this.visibility.length !== 2) {
          this.visibility = [true, this.ticketsPurchaseTarget.checked]
        }
        this.ticketsPriceTarget.checked = this.visibility[0]
        this.ticketsPurchaseTarget.checked = this.visibility[1]
        break
      case 'coin-supply':
        if (this.visibility.length !== 3) {
          this.visibility = [true, true, this.anonymitySetTarget.checked]
        }
        this.anonymitySetTarget.checked = this.visibility[2]
        break
      case 'privacy-participation':
        if (this.visibility.length !== 2) {
          this.visibility = [true, this.anonymitySetTarget.checked]
        }
        this.anonymitySetTarget.checked = this.visibility[1]
        break
      case 'avg-age-days':
      case 'coin-days-destroyed':
      case 'coin-age-bands':
      case 'mean-coin-age':
      case 'total-coin-days':
        if (this.visibility.length !== 2) {
          this.visibility = [true, this.marketPriceTarget.checked]
        }
        this.marketPriceTarget.checked = this.visibility[1]
        break
      default:
        return
    }
    this.settings.visibility = this.visibility.join('-')
    if (!this.isHomepage) {
      this.query.replace(this.settings)
    }
  }

  setActiveOptionBtn (opt, optTargets) {
    optTargets.forEach(li => {
      if (li.dataset.option === opt) {
        li.classList.add('active')
      } else {
        li.classList.remove('active')
      }
    })
  }

  setActiveToggleBtn (opt, optTargets) {
    optTargets.forEach(button => {
      if (button.name === opt) {
        button.classList.add('active')
      } else {
        button.classList.remove('active')
      }
    })
  }

  selectedBin () { return this.selectedButtons(this.binButtons) }
  selectedScale () { return this.selectedButtons(this.scaleButtons) }
  selectedAxis () { return this.selectedOption(this.axisOptionTargets) }
  selectedRange () { return this.selectedOption(this.rangeOptionTargets) }

  selectedOption (optTargets) {
    let key = false
    optTargets.forEach((el) => {
      if (el.classList.contains('active')) key = el.dataset.option
    })
    return key
  }

  selectedButtons (btnTargets) {
    let key = false
    btnTargets.forEach((btn) => {
      if (btn.classList.contains('active')) key = btn.name
    })
    return key
  }
}
