import txInBlock from '../helpers/block_helper'
import globalEventBus from '../services/event_bus_service'
import { barChartPlotter } from '../helpers/chart_helper'
import { Controller } from '@hotwired/stimulus'
import humanize from '../helpers/humanize_helper'
import { MiniMeter } from '../helpers/meters.js'
import { darkEnabled } from '../services/theme_service'
import { getDefault } from '../helpers/module_helper'
import { requestJSON } from '../helpers/http'

const chartLayout = {
  showRangeSelector: true,
  legend: 'follow',
  fillGraph: true,
  colors: ['#0c644e', '#f36e6e'],
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
  if (d == null || !(d.yes instanceof Array)) return [[0, 0, 0]]
  return d.yes.map((n, i) => {
    return [
      new Date(d.time[i]),
      n,
      d.no[i]
    ]
  })
}

function voteChoicesByBlockData (d) {
  if (d == null || !(d.yes instanceof Array)) return [[0, 0, 0]]
  return d.yes.map((n, i) => {
    return [
      d.height[i],
      n,
      d.no[i]
    ]
  })
}

export default class extends Controller {
  static get targets () {
    return ['unconfirmed', 'confirmations', 'formattedAge', 'age', 'progressBar',
      'ticketStage', 'expiryChance', 'mempoolTd', 'ticketMsg',
      'expiryMsg', 'statusMsg', 'spendingTx', 'approvalMeter', 'cumulativeVoteChoices',
      'voteChoicesByBlock', 'outputRow', 'showMoreText', 'showMoreIcon']
  }

  initialize () {
    this.emptydata = [[0, 0, 0]]
    this.cumulativeVoteChoicesChart = false
    this.voteChoicesByBlockChart = false
  }

  async connect () {
    this.txid = this.data.get('txid')
    this.type = this.data.get('type')
    this.isTSpend = this.type === 'Treasury Spend'
    this.processBlock = this._processBlock.bind(this)
    this.tspendExpend = false
    this.targetBlockTime = parseInt(document.getElementById('navBar').dataset.blocktime)
    globalEventBus.on('BLOCK_RECEIVED', this.processBlock)

    if (this.isTSpend) {
      this.Dygraph = await getDefault(
        import(/* webpackChunkName: "dygraphs" */ '../vendor/dygraphs.min.js')
      )
      this.drawCharts()
      const agendaResponse = await requestJSON('/api/treasury/votechart/' + this.txid)
      this.cumulativeVoteChoicesChart.updateOptions({
        file: cumulativeVoteChoicesData(agendaResponse.by_time)
      })
      this.voteChoicesByBlockChart.updateOptions({
        file: voteChoicesByBlockData(agendaResponse.by_height)
      })
    }

    // Approval meter for tspend votes.
    if (!this.hasApprovalMeterTarget) return // there will be no meter.

    const d = this.approvalMeterTarget.dataset
    const opts = {
      darkMode: darkEnabled(),
      segments: [
        { end: d.threshold, color: '#ed6d47' },
        { end: 1, color: '#2dd8a3' }
      ]
    }
    this.approvalMeter = new MiniMeter(this.approvalMeterTarget, opts)
  }

  drawCharts () {
    this.cumulativeVoteChoicesChart = this.drawChart(
      this.cumulativeVoteChoicesTarget,
      {
        labels: ['Date', 'Yes', 'No'],
        ylabel: 'Cumulative Vote Choices Cast',
        title: 'Cumulative Vote Choices',
        labelsKMB: true
      }
    )
    this.voteChoicesByBlockChart = this.drawChart(
      this.voteChoicesByBlockTarget,
      {
        labels: ['Block Height', 'Yes', 'No'],
        ylabel: 'Vote Choices Cast',
        title: 'Vote Choices By Block',
        plotter: barChartPlotter
      }
    )
  }

  toggleExpand () {
    this.tspendExpend = !this.tspendExpend
    if (!this.outputRowTargets || this.outputRowTargets.length === 0) {
      return
    }
    this.outputRowTargets.forEach((rowTarget) => {
      // get index
      const index = rowTarget.dataset.index
      if (Number(index) < 5) {
        return
      }
      if (this.tspendExpend) {
        rowTarget.classList.remove('d-hide')
      } else {
        rowTarget.classList.add('d-hide')
      }
    })
    this.showMoreTextTarget.textContent = this.tspendExpend ? 'Show Less' : 'Show More'
    if (this.tspendExpend) {
      this.showMoreIconTarget.classList.add('reverse')
    } else {
      this.showMoreIconTarget.classList.remove('reverse')
    }
  }

  disconnect () {
    globalEventBus.off('BLOCK_RECEIVED', this.processBlock)
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

  _processBlock (blockData) {
    const block = blockData.block
    const extra = blockData.extra
    // If this is a transaction in mempool, it will have an unconfirmedTarget.
    if (this.hasUnconfirmedTarget) {
      const txid = this.unconfirmedTarget.dataset.txid
      if (txInBlock(txid, block)) {
        this.confirmationsTarget.textContent = this.confirmationsTarget.dataset.yes.replace('#', '1').replace('@', '')
        this.confirmationsTarget.classList.add('confirmed')
        // Set the block link
        const link = this.unconfirmedTarget.querySelector('.mp-unconfirmed-link')
        link.href = '/block/' + block.hash
        link.textContent = block.height
        this.unconfirmedTarget.querySelector('.mp-unconfirmed-msg').classList.add('d-none')
        // Reset the age and time to be based off of the block time.
        const age = this.unconfirmedTarget.querySelector('.mp-unconfirmed-time')
        age.dataset.age = block.time
        age.textContent = humanize.timeSince(block.unixStamp)
        this.formattedAgeTarget.textContent = humanize.date(block.time, true)
        this.ageTarget.dataset.age = block.unixStamp
        this.ageTarget.textContent = humanize.timeSince(block.unixStamp)
        this.ageTarget.dataset.timeTarget = 'age'
        // Prepare the progress bar for updating
        if (this.hasProgressBarTarget) {
          this.progressBarTarget.dataset.confirmHeight = block.height
        }
        delete this.unconfirmedTarget.dataset.txTarget
      }
    }

    // Look for any unconfirmed matching tx hashes in the table.
    if (this.hasMempoolTdTarget) {
      this.mempoolTdTargets.forEach((td) => {
        const txid = td.dataset.txid
        if (txInBlock(txid, block)) {
          const link = document.createElement('a')
          link.textContent = block.height
          link.href = `/block/${block.height}`
          while (td.firstChild) td.removeChild(td.firstChild)
          td.appendChild(link)
          delete td.dataset.txTarget
        }
      })
    }

    // Advance the progress bars.
    if (!this.hasProgressBarTarget) {
      return
    }
    const bar = this.progressBarTarget
    let txBlockHeight = parseInt(bar.dataset.confirmHeight)
    if (txBlockHeight === 0) {
      return
    }
    let confirmations = block.height - txBlockHeight + 1
    let txType = bar.dataset.txType
    let complete = parseInt(bar.getAttribute('aria-valuemax'))

    if (txType === 'LiveTicket') {
      // Check for a spending vote
      const votes = block.Votes || []
      for (const idx in votes) {
        const vote = votes[idx]
        if (this.txid === vote.VoteInfo.ticket_spent) {
          const link = document.createElement('a')
          link.href = `/tx/${vote.TxID}`
          link.textContent = 'vote'
          const msg = this.spendingTxTarget
          while (msg.firstChild) msg.removeChild(msg.firstChild)
          msg.appendChild(link)
          this.ticketStageTarget.innerHTML = 'Voted'
          return
        }
      }
    }

    if (confirmations === complete + 1) {
      // Hide bars after completion, or change ticket to live ticket
      if (txType === 'Ticket') {
        txType = bar.dataset.txType = 'LiveTicket'
        const expiry = parseInt(bar.dataset.expiry)
        bar.setAttribute('aria-valuemax', expiry)
        txBlockHeight = bar.dataset.confirmHeight = block.height
        this.ticketMsgTarget.classList.add('d-none')
        this.expiryMsgTarget.classList.remove('d-none')
        confirmations = 1
        complete = expiry
      } else {
        this.ticketStageTarget.innerHTML = txType === 'LiveTicket' ? 'Expired' : 'Mature'
        return
      }
    }

    const barMsg = bar.querySelector('span')
    if (confirmations === complete) {
      // Special case: progress reaching max
      switch (txType) {
        case 'Ticket':
          barMsg.textContent = 'Mature. Eligible to vote on next block.'
          this.statusMsgTarget.textContent = 'live'
          break
        case 'LiveTicket':
          barMsg.textContent = 'Ticket has expired'
          delete bar.dataset.txTarget
          this.statusMsgTarget.textContent = 'expired'
          break
        default: // Vote
          barMsg.textContent = 'Mature. Ready to spend.'
          this.statusMsgTarget.textContent = 'mature'
      }
      return
    }

    // Otherwise, set the bar appropriately
    const blocksLeft = complete + 1 - confirmations
    const remainingTime = blocksLeft * this.targetBlockTime
    switch (txType) {
      case 'LiveTicket': {
        barMsg.textContent = `block ${confirmations} of ${complete} (${(remainingTime / 86400.0).toFixed(1)} days remaining)`
        // Chance of expiring is (1-P)^N where P := single-block probability of being picked, N := blocks remaining.
        const pctChance = Math.pow(1 - parseFloat(bar.dataset.ticketsPerBlock) / extra.pool_info.size, blocksLeft) * 100
        this.expiryChanceTarget.textContent = `${pctChance.toFixed(2)}%`
        break
      }
      case 'Ticket':
        barMsg.textContent = `Immature, eligible to vote in ${blocksLeft} blocks (${(remainingTime / 3600.0).toFixed(1)} hours remaining)`
        break
      default: // Vote
        barMsg.textContent = `Immature, spendable in ${blocksLeft} blocks (${(remainingTime / 3600.0).toFixed(1)} hours remaining)`
    }
    bar.setAttribute('aria-valuenow', confirmations)
    bar.style.width = `${(confirmations / complete * 100).toString()}%`
  }

  toggleScriptData (e) {
    const target = e.srcElement || e.target
    const scriptData = target.querySelector('div.script-data')
    if (!scriptData) return
    scriptData.classList.toggle('d-hide')
  }

  _setNightMode (state) {
    if (this.approvalMeter) {
      this.approvalMeter.setDarkMode(state.nightMode)
    }
  }
}
