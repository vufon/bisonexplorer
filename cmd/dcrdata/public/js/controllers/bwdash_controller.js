import { Controller } from '@hotwired/stimulus'
import { requestJSON } from '../helpers/http'
import * as Plotly from 'plotly.js-dist-min'
import humanize from '../helpers/humanize_helper'

const pairList = ['btc_usdc.eth', 'btc_usdt.polygon', 'dcr_btc', 'dcr_ltc', 'dcr_polygon', 'dcr_usdc.eth',
  'dcr_usdc.polygon', 'dcr_usdt.polygon', 'dgb_btc', 'dgb_usdt.polygon', 'doge_btc', 'eth_btc', 'ltc_btc',
  'ltc_usdt.polygon', 'usdc.polygon_usdt.polygon', 'zec_btc', 'zec_usdc.eth', 'zec_usdt.polygon'
]

const pairColor = ['#690e20', '#71114b', '#582369', '#402369', '#2c2086', '#434c9a', '#117a7d', '#199b72',
  '#177026', '#82ae14', '#92780b', '#92510b', '#92340b', '#762216', '#3f5561', '#598ca1', '#75cda1', '#cd759e'
]
export default class extends Controller {
  static get targets () {
    return ['todayStr', 'todayData', 'monthlyStr', 'currentMonthData', 'prevMonthStr', 'prevMonthData',
      'last90DaysData', 'last6MonthsData', 'lastYearData']
  }

  async connect () {
    const _this = this
    this.hasData = []
    this.chartData = []
    const selectorOptions = {
      buttons: [{
        step: 'month',
        stepmode: 'backward',
        count: 6,
        label: '6m'
      }, {
        step: 'month',
        stepmode: 'backward',
        count: 12,
        label: '12m'
      }, {
        step: 'month',
        stepmode: 'backward',
        count: 24,
        label: '24m'
      }, {
        step: 'all',
        label: 'all'
      }]
    }
    this.layout = {
      barmode: 'stack',
      showlegend: true,
      xaxis: {
        rangeselector: selectorOptions,
        rangeslider: { visible: false }
      },
      legend: { orientation: 'h', xanchor: 'center', x: 0.5, y: 1 }
    }
    // check currency pair with data
    const bwDashDataRes = await this.calculate()
    const monthlyData = bwDashDataRes.monthlyData
    // init data for summary
    this.dailyData = bwDashDataRes.dailyData
    // weekly data
    // const weeklyData = bwDashDataRes.weeklyData
    // today data
    const lastDayData = this.dailyData[this.dailyData.length - 1]
    this.todayStrTarget.textContent = lastDayData[0].replaceAll('-', '/')
    this.todayDataTarget.innerHTML = '$' + humanize.decimalParts(lastDayData[lastDayData.length - 1], true, 0, 0)
    const lastMonthData = monthlyData[monthlyData.length - 1]
    const prevMonthData = monthlyData[monthlyData.length - 2]
    // current month data
    this.monthlyStrTarget.textContent = lastMonthData[0].replaceAll('-', '/')
    this.currentMonthDataTarget.innerHTML = '$' + humanize.decimalParts(lastMonthData[lastMonthData.length - 1], true, 0, 0)
    // prev month data
    this.prevMonthStrTarget.textContent = prevMonthData[0].replaceAll('-', '/')
    this.prevMonthDataTarget.innerHTML = '$' + humanize.decimalParts(prevMonthData[prevMonthData.length - 1], true, 0, 0)
    // last 90 days data
    let last90daysSum = 0
    for (let i = this.dailyData.length - 1; i >= this.dailyData.length - 90; i--) {
      const itemData = this.dailyData[i]
      last90daysSum += Number(itemData[itemData.length - 1])
    }
    this.last90DaysDataTarget.innerHTML = '$' + humanize.decimalParts(last90daysSum, true, 0, 0)
    // last 6 months data
    let last6MonthsSum = 0
    for (let i = monthlyData.length - 1; i >= monthlyData.length - 6; i--) {
      const itemData = monthlyData[i]
      last6MonthsSum += Number(itemData[itemData.length - 1])
    }
    this.last6MonthsDataTarget.innerHTML = '$' + humanize.decimalParts(last6MonthsSum, true, 0, 0)
    // last year data (364 days)
    let lastYearSum = 0
    for (let i = this.dailyData.length - 1; i >= this.dailyData.length - 364; i--) {
      const itemData = this.dailyData[i]
      lastYearSum += Number(itemData[itemData.length - 1])
    }
    this.lastYearDataTarget.innerHTML = '$' + humanize.decimalParts(lastYearSum, true, 0, 0)
    pairList.forEach((pair, index) => {
      let hasDataBool = false
      monthlyData.forEach((item) => {
        const volValue = Number(item[index + 1])
        if (volValue > 0 && hasDataBool === false) {
          hasDataBool = true
        }
      })
      _this.hasData.push(hasDataBool)
    })

    // init chart data
    pairList.forEach((pair, index) => {
      if (this.hasData[index]) {
        const xLabel = []
        const yLabel = []
        monthlyData.forEach((item) => {
          xLabel.push(item[0])
          yLabel.push(Number(item[index + 1]))
        })
        _this.chartData.push({
          x: xLabel,
          y: yLabel,
          name: pair,
          marker: {
            color: pairColor[index],
            width: 1
          },
          type: 'bar'
        })
      }
    })
    Plotly.newPlot('myDiv', this.chartData, this.layout)
  }

  async calculate () {
    const bwDashUrl = '/api/bwdash/getdata'
    const bwDashRes = await requestJSON(bwDashUrl)
    return bwDashRes
  }
}
