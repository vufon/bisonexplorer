import { Controller } from '@hotwired/stimulus'
import { barChartPlotter } from '../helpers/chart_helper'
import { getDefault } from '../helpers/module_helper'
import humanize from '../helpers/humanize_helper'
import { requestJSON } from '../helpers/http'
import { MiniMeter } from '../helpers/meters.js'
import globalEventBus from '../services/event_bus_service'
import { darkEnabled } from '../services/theme_service'

const chartLayout = {
  showRangeSelector: true,
  legend: 'follow',
  fillGraph: true,
  colors: ['rgb(0,153,0)', 'orange', 'red'],
  stackedGraph: true,
  legendFormatter: agendasLegendFormatter,
  labelsSeparateLines: true,
  labelsKMB: true,
  labelsUTC: true
}

function agendasLegendFormatter (data) {
  if (data.x == null) return ''
  let html
  if (this.getLabels()[0] === 'Date') {
    html = this.getLabels()[0] + ': ' + humanize.date(data.x)
  } else {
    html = this.getLabels()[0] + ': ' + data.xHTML
  }
  const total = data.series.reduce((total, n) => {
    return total + n.y
  }, 0)
  data.series.forEach((series) => {
    const percentage = total !== 0 ? ((series.y * 100) / total).toFixed(2) : 0
    html = '<span style="color:#2d2d2d;">' + html + '</span>'
    html += `<br>${series.dashHTML}<span style="color: ${series.color};">${series.labelHTML}: ${series.yHTML} (${percentage}%)</span>`
  })
  return html
}

function cumulativeVoteChoicesData (d) {
  if (d == null || !(d.yes instanceof Array)) return [[0, 0, 0, 0]]
  return d.yes.map((n, i) => {
    return [
      new Date(d.time[i]),
      n,
      d.abstain[i],
      d.no[i]
    ]
  })
}

function voteChoicesByBlockData (d) {
  if (d == null || !(d.yes instanceof Array)) return [[0, 0, 0, 0]]
  return d.yes.map((n, i) => {
    return [
      d.height[i],
      n,
      d.abstain[i],
      d.no[i]
    ]
  })
}

export default class extends Controller {
  static get targets () {
    return [
      'cumulativeVoteChoices',
      'voteChoicesByBlock',
      'agendaName',
      'extendDescription',
      'approvalMeter'
    ]
  }

  initialize () {
    this.emptydata = [[0, 0, 0, 0]]
    this.cumulativeVoteChoicesChart = false
    this.voteChoicesByBlockChart = false
  }

  async connect () {
    this.agendaId = this.data.get('id')
    this.element.classList.add('loading')
    this.agendaName = this.data.get('name')
    this.description = this.data.get('description')
    this.agendaNameTarget.innerHTML = this.changeToHTMLTag(this.agendaName)
    this.extendDescriptionTarget.innerHTML = this.changeToHTMLTag(this.description)
    const d = this.approvalMeterTarget.dataset
    const opts = {
      darkMode: darkEnabled(),
      segments: [
        { end: d.threshold, color: '#ed6d47' },
        { end: 1, color: '#2dd8a3' }
      ]
    }
    this.meter = new MiniMeter(this.approvalMeterTarget, opts)
    this.setNightMode = this._setNightMode.bind(this)
    globalEventBus.on('NIGHT_MODE', this.setNightMode)
    this.Dygraph = await getDefault(
      import(/* webpackChunkName: "dygraphs" */ '../vendor/dygraphs.min.js')
    )
    this.drawCharts()
    const agendaResponse = await requestJSON('/api/agenda/' + this.agendaId)
    this.cumulativeVoteChoicesChart.updateOptions({
      file: cumulativeVoteChoicesData(agendaResponse.by_time)
    })
    this.voteChoicesByBlockChart.updateOptions({
      file: voteChoicesByBlockData(agendaResponse.by_height)
    })

    this.element.classList.remove('loading')
  }

  _setNightMode (state) {
    this.meter.setDarkMode(state.nightMode)
  }

  changeToHTMLTag (input) {
    while (input.indexOf('[[') >= 0 && input.indexOf(']]') >= 0) {
      const start = input.indexOf('[[') + 2
      const end = input.indexOf(']]')
      const inText = input.substring(start, end)
      if (inText.indexOf('((') >= 0 && inText.indexOf('))') >= 0) {
        const linkStart = inText.indexOf('((') + 2
        const linkEnd = inText.indexOf('))')
        const link = inText.substring(linkStart, linkEnd)
        const mainText = inText.replace('((' + link + '))', '')
        const htmlLink = '<a href="' + link + '" target="_blank">' + mainText + '</a>'
        input = input.replace('[[' + inText + ']]', htmlLink)
      } else break
    }
    return input
  }

  disconnect () {
    this.cumulativeVoteChoicesChart.destroy()
    this.voteChoicesByBlockChart.destroy()
  }

  drawCharts () {
    this.cumulativeVoteChoicesChart = this.drawChart(
      this.cumulativeVoteChoicesTarget,
      {
        labels: ['Date', 'Yes', 'Abstain', 'No'],
        ylabel: 'Cumulative Vote Choices Cast',
        title: 'Cumulative Vote Choices',
        labelsKMB: true
      }
    )
    this.voteChoicesByBlockChart = this.drawChart(
      this.voteChoicesByBlockTarget,
      {
        labels: ['Block Height', 'Yes', 'Abstain', 'No'],
        ylabel: 'Vote Choices Cast',
        title: 'Vote Choices By Block',
        plotter: barChartPlotter
      }
    )
  }

  drawChart (el, options, Dygraph) {
    return new this.Dygraph(
      el,
      this.emptydata,
      {
        ...chartLayout,
        ...options
      }
    )
  }
}
