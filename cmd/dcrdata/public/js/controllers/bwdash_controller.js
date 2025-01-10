import { Controller } from '@hotwired/stimulus'
import * as Plotly from 'plotly.js-dist-min'
import humanize from '../helpers/humanize_helper'

const pairList = ['btc_usdc.eth', 'btc_usdt.polygon', 'dcr_btc', 'dcr_ltc', 'dcr_polygon', 'dcr_usdc.eth',
  'dcr_usdc.polygon', 'dcr_usdt.polygon', 'dgb_btc', 'dgb_usdt.polygon', 'doge_btc', 'eth_btc', 'ltc_btc',
  'ltc_usdt.polygon', 'usdc.polygon_usdt.polygon', 'zec_btc', 'zec_usdc.eth', 'zec_usdt.polygon'
]

const pairColor = ['#690e20', '#38b6ba', '#0f103f', '#2fc399', '#289f87', '#434c9a', '#1c5863', '#153451',
  '#3169e1', '#82ae14', '#92780b', '#92510b', '#3ca2ca', '#34cbaa', '#227b75', '#408ddb', '#75cda1', '#cd759e'
]
export default class extends Controller {
  static get targets () {
    return ['todayStr', 'todayData', 'monthlyStr', 'currentMonthData', 'prevMonthStr', 'prevMonthData',
      'last90DaysData', 'last6MonthsData', 'lastYearData', 'prevMonthBreakdown', 'curMonthBreakdown',
      'pageLoader']
  }

  async connect () {
    this.pageLoaderTarget.classList.add('loading')
    const _this = this
    this.hasData = []
    this.chartData = []
    this.weekChartData = []
    this.dailyChartData = []
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
    const dailySelectorOptions = {
      buttons: [{
        step: 'day',
        stepmode: 'backward',
        count: 7,
        label: '7d'
      }, {
        step: 'day',
        stepmode: 'backward',
        count: 30,
        label: '30d'
      }, {
        step: 'day',
        stepmode: 'backward',
        count: 90,
        label: '90d'
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
      legend: { orientation: 'h', xanchor: 'center', x: 0.5, traceorder: 'normal' }
    }
    this.dailyLayout = {
      barmode: 'stack',
      showlegend: true,
      xaxis: {
        rangeselector: dailySelectorOptions,
        rangeslider: { visible: false }
      },
      legend: { orientation: 'h', xanchor: 'center', x: 0.5, traceorder: 'normal' }
    }
    // check currency pair with data
    this.dailyData = await this.fetchCsvDataFromUrl()
    const monthlyData = this.groupMonthlyData(this.dailyData)
    // weekly data
    const weeklyData = this.groupWeeklyData(this.dailyData)
    // calculate sum for all row of daily data
    for (let i = 0; i < this.dailyData.length; i++) {
      const sumOfRow = this.sumVolOfBwRow(this.dailyData[i])
      this.dailyData[i].push(sumOfRow)
    }
    // today data
    const lastDayData = this.dailyData[this.dailyData.length - 1]
    const lastDayArr = lastDayData[0].split('-')
    const lastMonthName = this.getMonthName(lastDayArr[1])
    this.todayStrTarget.textContent = lastMonthName + ' ' + lastDayArr[2] + ', ' + lastDayArr[0]
    this.todayDataTarget.innerHTML = '$' + humanize.decimalParts(lastDayData[lastDayData.length - 1], true, 0, 0)
    const lastMonthData = monthlyData[monthlyData.length - 1]
    const prevMonthData = monthlyData[monthlyData.length - 2]
    // current month data
    this.monthlyStrTarget.textContent = lastMonthName + ' ' + lastDayArr[0]
    this.curMonthBreakdownTarget.textContent = lastMonthName + ' ' + lastDayArr[0]
    this.currentMonthDataTarget.innerHTML = '$' + humanize.decimalParts(lastMonthData[lastMonthData.length - 1], true, 0, 0)
    // prev month data
    const prevMonthArr = prevMonthData[0].split('-')
    const prevMonthName = this.getMonthName(prevMonthArr[1])
    this.prevMonthStrTarget.textContent = prevMonthName + ' ' + prevMonthArr[0]
    this.prevMonthBreakdownTarget.textContent = prevMonthName + ' ' + prevMonthArr[0]
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
    // last year data (52 weeks)
    let lastYearSum = 0
    for (let i = weeklyData.length - 1; i >= weeklyData.length - 51; i--) {
      const itemData = weeklyData[i]
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
    const curPercentArr = []
    const curLabels = []
    const curColors = []
    const prevPercentArr = []
    const prevLabels = []
    const prevColors = []
    // init chart data
    pairList.forEach((pair, index) => {
      if (this.hasData[index]) {
        // init for monthly vol bar chart
        const xLabel = []
        const yLabel = []
        let sum = 0
        monthlyData.forEach((item) => {
          xLabel.push(item[0])
          const itemValue = Number(item[index + 1])
          yLabel.push(itemValue)
          sum += itemValue
        })
        _this.chartData.push({
          x: xLabel,
          y: yLabel,
          name: pair,
          marker: {
            color: pairColor[index],
            width: 1
          },
          type: 'bar',
          total: sum
        })
        // init for weekly vol bar chart
        const xWeekLabel = []
        const yWeekLabel = []
        let weeklySum = 0
        weeklyData.forEach((item) => {
          xWeekLabel.push(item[0])
          const itemValue = Number(item[index + 1])
          yWeekLabel.push(itemValue)
          weeklySum += itemValue
        })
        _this.weekChartData.push({
          x: xWeekLabel,
          y: yWeekLabel,
          name: pair,
          marker: {
            color: pairColor[index],
            width: 1
          },
          type: 'bar',
          total: weeklySum
        })
        // init for daily vol bar chart
        const xDailyLabel = []
        const yDailyLabel = []
        let dailySum = 0
        _this.dailyData.forEach((item) => {
          xDailyLabel.push(item[0])
          const itemValue = Number(item[index + 1])
          yDailyLabel.push(itemValue)
          dailySum += itemValue
        })
        _this.dailyChartData.push({
          x: xDailyLabel,
          y: yDailyLabel,
          name: pair,
          marker: {
            color: pairColor[index],
            width: 1
          },
          type: 'bar',
          total: dailySum
        })
        // init for current month breakdown
        const curValueFloat = Number(lastMonthData[index + 1])
        if (curValueFloat > 0) {
          curLabels.push(pair)
          curPercentArr.push(curValueFloat)
          curColors.push(pairColor[index])
        }
        // init for current month breakdown
        const prevValueFloat = Number(prevMonthData[index + 1])
        if (prevValueFloat > 0) {
          prevLabels.push(pair)
          prevPercentArr.push(prevValueFloat)
          prevColors.push(pairColor[index])
        }
      }
    })
    const curBreakdownChartData = [{
      values: curPercentArr,
      labels: curLabels,
      marker: {
        colors: curColors
      },
      type: 'pie'
    }]
    const prevBreakdownChartData = [{
      values: prevPercentArr,
      labels: prevLabels,
      marker: {
        colors: prevColors
      },
      type: 'pie'
    }]
    // sort monthly trading volume chart data
    this.chartData.sort(function (a, b) {
      return a.total === b.total ? 0 : (a.total > b.total ? -1 : 1)
    })
    // sort weekly trading volume chart data
    this.weekChartData.sort(function (a, b) {
      return a.total === b.total ? 0 : (a.total > b.total ? -1 : 1)
    })
    // sort daily trading volume chart data
    this.dailyChartData.sort(function (a, b) {
      return a.total === b.total ? 0 : (a.total > b.total ? -1 : 1)
    })
    const pieLayout = {
      legend: { orientation: 'h', xanchor: 'center', x: 0.5 }
    }
    Plotly.newPlot('monthlyTradingVolume', this.chartData, this.layout)
    Plotly.newPlot('weeklyTradingVolume', this.weekChartData, this.layout)
    Plotly.newPlot('dailyTradingVolume', this.dailyChartData, this.dailyLayout)
    Plotly.newPlot('curMonthBreakdownChart', curBreakdownChartData, pieLayout)
    Plotly.newPlot('prevMonthBreakdownChart', prevBreakdownChartData, pieLayout)
    this.pageLoaderTarget.classList.remove('loading')
  }

  getMonthName (monthNumStr) {
    const monthNames = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']
    const monthNum = this.getMonthNumber(monthNumStr)
    return monthNames[monthNum - 1]
  }

  getMonthNumber (monthStr) {
    if (monthStr.startsWith('0')) {
      return Number(monthStr.replaceAll('0', ''))
    }
    return Number(monthStr)
  }

  async fetchCsvDataFromUrl () {
    const data = await this.getCsvContent()
    const csvData = []
    const jsonObject = data.split(/\r?\n|\r/)
    if (jsonObject.length < 2) {
      return csvData
    }
    // Skip first header line
    for (let i = 1; i < jsonObject.length; i++) {
      if (jsonObject[i] === '' || jsonObject[i].trim() === '') {
        continue
      }
      csvData.push(jsonObject[i].split(','))
    }
    return csvData
  }

  async getCsvContent () {
    return $.ajax({
      url: 'https://raw.githubusercontent.com/bochinchero/dcrsnapcsv/main/data/stream/dex_decred_org_VolUSD.csv',
      type: 'get',
      dataType: 'text'
    })
      .then(function (res) {
        return res
      })
  }

  groupWeeklyData (records) {
    const res = []
    let curWeekData = []
    let curWeekDataNum = []
    let lastTime
    records.forEach((record) => {
      if (record.length < 1 || record[0].trim() === '') {
        return
      }
      const dateRec = new Date(record[0])
      if (dateRec.getTime() <= 0) {
        return
      }
      const weekDayNum = dateRec.getDay()
      if (curWeekDataNum.length === 0) {
        for (let i = 1; i < record.length; i++) {
          const recordFloat = Number(record[i])
          curWeekDataNum.push(recordFloat)
        }
      } else {
        for (let i = 1; i < record.length; i++) {
          const recordFloat = Number(record[i])
          curWeekDataNum[i - 1] += recordFloat
        }
      }
      // if weekday is Monday
      if (weekDayNum === 1) {
        curWeekData.push(record[0])
        let sum = 0
        curWeekDataNum.forEach((dataNum) => {
          curWeekData.push(dataNum + '')
          sum += dataNum
        })
        curWeekData.push(sum + '')
        res.push(curWeekData)
        curWeekData = []
        curWeekDataNum = []
      }
      lastTime = dateRec
    })
    if (curWeekDataNum.length > 0) {
      // check nearest week
      for (let i = 0; i < 7; i++) {
        const nextDayInt = lastTime.setDate(lastTime.getDate() + i)
        const nextDay = new Date(nextDayInt)
        if (nextDay.getDay() === 1) {
          curWeekData.push(humanize.date(nextDay, false, true))
          let sum = 0
          curWeekDataNum.forEach((dataNum) => {
            curWeekData.push(dataNum + '')
            sum += dataNum
          })
          curWeekData.push(sum + '')
          res.push(curWeekData)
          break
        }
      }
    }
    return res
  }

  groupMonthlyData (records) {
    let currentMonth = ''
    let currentYear = ''
    const res = []
    let curMonthData = []
    records.forEach((record, index) => {
      const dateArray = record[0].split('-')
      if (currentMonth === '') {
        currentYear = dateArray[0]
        currentMonth = dateArray[1]
        curMonthData.push(dateArray[0] + '-' + dateArray[1])
        for (let i = 1; i < record.length; i++) {
          curMonthData.push(record[i])
        }
      } else if (dateArray[0] !== currentYear || dateArray[1] !== currentMonth) {
        currentYear = dateArray[0]
        currentMonth = dateArray[1]
        res.push(curMonthData)
        curMonthData = []
        curMonthData.push(dateArray[0] + '-' + dateArray[1])
        for (let i = 1; i < record.length; i++) {
          curMonthData.push(record[i])
        }
      } else {
        for (let i = 1; i < record.length; i++) {
          const curFloat = Number(curMonthData[i])
          const recordFloat = Number(record[i])
          curMonthData[i] = (curFloat + recordFloat) + ''
        }
      }
      if (index === records.length - 1) {
        res.push(curMonthData)
      }
    })
    const _this = this
    res.forEach((resItem, index) => {
      const sum = _this.sumVolOfBwRow(resItem)
      resItem.push(sum + '')
      res[index] = resItem
    })
    return res
  }

  sumVolOfBwRow (row) {
    let sum = 0
    row.forEach((value, index) => {
      if (index > 0) {
        const floatValue = Number(value)
        sum += floatValue
      }
    })
    return sum
  }
}
