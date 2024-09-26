import { Controller } from '@hotwired/stimulus'
import humanize from '../helpers/humanize_helper'
import ws from '../services/messagesocket_service'
import { keyNav } from '../services/keyboard_navigation_service'
import globalEventBus from '../services/event_bus_service'
import Mempool from '../helpers/mempool_helper'
import TurboQuery from '../helpers/turbolinks_helper'

const conversionRate = 100000000

function makeMempoolBlock (block) {
  let fees = 0
  if (!block.Transactions) return
  for (const tx of block.Transactions) {
    fees += tx.Fees
  }

  return `<div class="block-rows">
                    ${makeRewardsElement(block.Subsidy, fees, block.Votes.length, '#')}
                    ${makeVoteElements(block.Votes)}
                    ${makeTicketAndRevocationElements(block.Tickets, block.Revocations, '/mempool')}
                    ${makeTransactionElements(block.Transactions, '/mempool')}
                </div>`
}

function makeTransactionElements (transactions, blockHref) {
  let totalDCR = 0
  const transactionElements = []
  if (transactions) {
    for (let i = 0; i < transactions.length; i++) {
      const tx = transactions[i]
      totalDCR += tx.Total
      transactionElements.push(makeTxElement(tx, `block-tx ${i === 0 ? 'left-vs-block-data' : ''} ${i === transactions.length - 1 ? 'right-vs-block-data' : ''}`, 'Transaction', true))
    }
  }

  if (transactionElements.length > 50) {
    const total = transactionElements.length
    transactionElements.splice(30)
    transactionElements.push(`<span class="block-tx" style="flex-grow: 10; flex-basis: 50px;" title="Total of ${total} transactions">
                                    <a class="block-element-link" href="${blockHref}">+ ${total - 30}</a>
                                </span>`)
  }

  // totalDCR = Math.round(totalDCR);
  totalDCR = 1
  return `<div class="block-transactions px-1 my-1" style="flex-grow: ${totalDCR}">
                ${transactionElements.join('\n')}
            </div>`
}

function makeTxElement (tx, className, type, appendFlexGrow) {
  // const style = [ `opacity: ${(tx.VinCount + tx.VoutCount) / 10}` ];
  const style = []
  if (appendFlexGrow) {
    style.push(`flex-grow: ${Math.round(tx.Total)}`)
  }

  return `<span class="${className}" style="${style.join('; ')}" data-homepage-target="tooltip"
                title='{"object": "${type}", "total": "${tx.Total}", "vout": "${tx.VoutCount}", "vin": "${tx.VinCount}"}'>
                <a class="block-element-link" href="/tx/${tx.TxID}"></a>
            </span>`
}

function makeTicketAndRevocationElements (tickets, revocations, blockHref) {
  let totalDCR = 0
  const ticketElements = []
  const revCount = revocations ? revocations.length : 0
  const ticketCount = tickets ? tickets.length : 0
  if (tickets) {
    for (let i = 0; i < tickets.length; i++) {
      const ticket = tickets[i]
      totalDCR += ticket.Total
      ticketElements.push(makeTxElement(ticket, `block-ticket ${i === 0 ? 'left-vs-block-data' : ''} ${i === tickets.length - 1 && revCount === 0 ? 'right-vs-block-data' : ''}`, 'Ticket'))
    }
  }
  if (ticketElements.length > 50) {
    const total = ticketElements.length
    ticketElements.splice(30)
    ticketElements.push(`<span class="block-ticket" style="flex-grow: 10; flex-basis: 50px;" title="Total of ${total} tickets">
                                <a class="block-element-link" href="${blockHref}">+ ${total - 30}</a>
                            </span>`)
  }
  const revocationElements = []
  if (revCount > 0) {
    for (let i = 0; i < revCount; i++) {
      const revocation = revocations[i]
      totalDCR += revocation.Total
      revocationElements.push(makeTxElement(revocation, `block-rev ${ticketCount === 0 && i === 0 ? 'left-vs-block-data' : ''} ${i === revCount - 1 ? 'right-vs-block-data' : ''}`, 'Revocation'))
    }
  }

  const ticketsAndRevocationElements = ticketElements.concat(revocationElements)

  // append empty squares to tickets+revs
  for (let i = ticketsAndRevocationElements.length; i < 20; i++) {
    ticketsAndRevocationElements.push('<span title="Empty ticket slot"></span>')
  }

  // totalDCR = Math.round(totalDCR);
  totalDCR = 1
  return `<div class="block-tickets px-1 mt-1" style="flex-grow: ${totalDCR}">
                ${ticketsAndRevocationElements.join('\n')}
            </div>`
}

function makeVoteElements (votes) {
  let totalDCR = 0
  const voteLen = votes ? votes.length : 0
  const voteElements = []
  if (voteLen > 0) {
    for (let i = 0; i < voteLen - 1; i++) {
      const vote = votes[i]
      totalDCR += vote.Total
      voteElements.push(`<span style="background: ${vote.VoteValid ? 'linear-gradient(to right, #2971ff 0%, #528cff 100%)' : 'linear-gradient(to right, #fd714a 0%, #f6896a 100%)'}" data-homepage-target="tooltip"
                        title='{"object": "Vote", "voteValid": "${vote.VoteValid}"}' class="${i === 0 ? 'left-vs-block-data' : ''} ${i === voteLen - 1 ? 'right-vs-block-data' : ''}">
                        <a class="block-element-link" href="/tx/${vote.TxID}"></a>
                    </span>`)
    }
  }
  // append empty squares to votes
  for (let i = voteElements.length; i < 5; i++) {
    voteElements.push('<span title="Empty vote slot"></span>')
  }

  // totalDCR = Math.round(totalDCR);
  totalDCR = 1
  return `<div class="block-votes px-1 mt-1" style="flex-grow: ${totalDCR}">
                ${voteElements.join('\n')}
            </div>`
}

function makeRewardsElement (subsidy, fee, voteCount, rewardTxId) {
  if (!subsidy) {
    return `<div class="block-rewards px-1 mt-1">
                    <span class="pow"><span class="paint left-vs-block-data" style="width:100%;"></span></span>
                    <span class="pos"><span class="paint left-vs-block-data" style="width:100%;"></span></span>
                    <span class="fund"><span class="paint left-vs-block-data" style="width:100%;"></span></span>
                    <span class="fees right-vs-block-data" title='{"object": "Tx Fees", "total": "${fee}"}'></span>
                </div>`
  }

  const pow = subsidy.pow / conversionRate
  const pos = subsidy.pos / conversionRate
  const fund = (subsidy.developer || subsidy.dev) / conversionRate

  const backgroundColorRelativeToVotes = `style="width: ${voteCount * 20}%"` // 5 blocks = 100% painting

  // const totalDCR = Math.round(pow + fund + fee);
  const totalDCR = 1
  return `<div class="block-rewards px-1 mt-1" style="flex-grow: ${totalDCR}">
                <span class="pow" style="flex-grow: ${pow}" data-homepage-target="tooltip"
                    title='{"object": "PoW Reward", "total": "${pow}"}'>
                    <a class="block-element-link" href="/tx/${rewardTxId}">
                        <span class="paint left-vs-block-data" ${backgroundColorRelativeToVotes}></span>
                    </a>
                </span>
                <span class="pos" style="flex-grow: ${pos}" data-homepage-target="tooltip"
                    title='{"object": "PoS Reward", "total": "${pos}"}'>
                    <a class="block-element-link" href="/tx/${rewardTxId}">
                        <span class="paint" ${backgroundColorRelativeToVotes}></span>
                    </a>
                </span>
                <span class="fund" style="flex-grow: ${fund}" data-homepage-target="tooltip"
                    title='{"object": "Project Fund", "total": "${fund}"}'>
                    <a class="block-element-link" href="/tx/${rewardTxId}">
                        <span class="paint" ${backgroundColorRelativeToVotes}></span>
                    </a>
                </span>
                <span class="fees right-vs-block-data" style="flex-grow: ${fee}" data-homepage-target="tooltip"
                    title='{"object": "Tx Fees", "total": "${fee}"}'>
                    <a class="block-element-link" href="/tx/${rewardTxId}"></a>
                </span>
            </div>`
}

export default class extends Controller {
  static get targets () {
    return ['difficulty',
      'bsubsidyTotal', 'bsubsidyPow', 'bsubsidyPos', 'bsubsidyDev',
      'coinSupply', 'blocksdiff', 'devFund', 'windowIndex', 'posBar',
      'rewardIdx', 'powBar', 'poolSize', 'poolValue', 'ticketReward',
      'targetPct', 'poolSizePct', 'hashrate', 'hashrateDelta',
      'nextExpectedSdiff', 'nextExpectedMin', 'nextExpectedMax', 'mempool',
      'mpRegTotal', 'mpRegCount', 'mpTicketTotal', 'mpTicketCount', 'mpVoteTotal', 'mpVoteCount',
      'mpRevTotal', 'mpRevCount', 'voteTally', 'blockVotes', 'blockHeight', 'blockSize',
      'blockTotal', 'consensusMsg', 'powConverted', 'convertedDev',
      'convertedSupply', 'convertedDevSub', 'exchangeRate', 'convertedStake',
      'mixedPct', 'searchKey', 'memBlock', 'tooltip'
    ]
  }

  connect () {
    this.query = new TurboQuery()
    this.ticketsPerBlock = parseInt(this.mpVoteCountTarget.dataset.ticketsPerBlock)
    const mempoolData = this.mempoolTarget.dataset
    ws.send('getmempooltxs', mempoolData.id)
    this.mempool = new Mempool(mempoolData, this.voteTallyTargets)
    ws.registerEvtHandler('newtxs', (evt) => {
      const txs = JSON.parse(evt)
      this.mempool.mergeTxs(txs)
      this.setMempoolFigures()
      keyNav(evt, false, true)
      ws.send('getmempooltrimmed', '')
    })
    ws.registerEvtHandler('mempool', (evt) => {
      const m = JSON.parse(evt)
      this.mempool.replace(m)
      this.setMempoolFigures()
      keyNav(evt, false, true)
      ws.send('getmempooltxs', '')
      ws.send('getmempooltrimmed', '')
    })
    ws.registerEvtHandler('getmempooltxsResp', (evt) => {
      const m = JSON.parse(evt)
      this.mempool.replace(m)
      this.setMempoolFigures()
      keyNav(evt, false, true)
    })

    ws.registerEvtHandler('getmempooltrimmedResp', (event) => {
      this.handleMempoolUpdate(event)
    })

    this.processBlock = this._processBlock.bind(this)
    globalEventBus.on('BLOCK_RECEIVED', this.processBlock)
    this.setupTooltips()
  }

  handleMempoolUpdate (evt) {
    const mempool = JSON.parse(evt)
    mempool.Time = Math.round((new Date()).getTime() / 1000)
    this.memBlockTarget.innerHTML = makeMempoolBlock(mempool)
    this.setupTooltips()
  }

  setupTooltips () {
    this.tooltipTargets.forEach((tooltipElement) => {
      try {
        // parse the content
        const data = JSON.parse(tooltipElement.title)
        let newContent
        if (data.object === 'Vote') {
          newContent = `<b>${data.object} (${data.voteValid ? 'Yes' : 'No'})</b>`
        } else {
          newContent = `<b>${data.object}</b><br>${data.total} DCR`
        }

        if (data.vin && data.vout) {
          newContent += `<br>${data.vin} Inputs, ${data.vout} Outputs`
        }

        tooltipElement.title = newContent
      } catch (error) {}
    })

    import(/* webpackChunkName: "tippy" */ '../vendor/tippy.all').then(module => {
      const tippy = module.default
      tippy('.block-rows [title]', {
        allowTitleHTML: true,
        animation: 'shift-away',
        arrow: true,
        createPopperInstanceOnInit: true,
        dynamicTitle: true,
        performance: true,
        placement: 'top',
        size: 'small',
        sticky: true,
        theme: 'light'
      })
    })
  }

  disconnect () {
    ws.deregisterEvtHandlers('newtxs')
    ws.deregisterEvtHandlers('mempool')
    ws.deregisterEvtHandlers('getmempooltxsResp')
    ws.deregisterEvtHandlers('getmempooltrimmedResp')
    globalEventBus.off('BLOCK_RECEIVED', this.processBlock)
  }

  setMempoolFigures () {
    const totals = this.mempool.totals()
    const counts = this.mempool.counts()
    this.mpRegTotalTarget.textContent = humanize.threeSigFigs(totals.regular)
    this.mpRegCountTarget.textContent = counts.regular

    this.mpTicketTotalTarget.textContent = humanize.threeSigFigs(totals.ticket)
    this.mpTicketCountTarget.textContent = counts.ticket

    this.mpVoteTotalTarget.textContent = humanize.threeSigFigs(totals.vote)

    const ct = this.mpVoteCountTarget
    while (ct.firstChild) ct.removeChild(ct.firstChild)
    this.mempool.voteSpans(counts.vote).forEach((span) => { ct.appendChild(span) })

    this.mpRevTotalTarget.textContent = humanize.threeSigFigs(totals.rev)
    this.mpRevCountTarget.textContent = counts.rev

    this.mempoolTarget.textContent = humanize.threeSigFigs(totals.total)
    this.setVotes()
  }

  setVotes () {
    const hash = this.blockVotesTarget.dataset.hash
    const votes = this.mempool.blockVoteTally(hash)
    this.blockVotesTarget.querySelectorAll('div').forEach((div, i) => {
      const span = div.firstElementChild
      if (i < votes.affirm) {
        span.className = 'd-inline-block dcricon-affirm'
        div.dataset.tooltip = 'the stakeholder has voted to accept this block'
      } else if (i < votes.affirm + votes.reject) {
        span.className = 'd-inline-block dcricon-reject'
        div.dataset.tooltip = 'the stakeholder has voted to reject this block'
      } else {
        span.className = 'd-inline-block dcricon-missing'
        div.dataset.tooltip = 'this vote has not been received yet'
      }
    })
    const threshold = this.ticketsPerBlock / 2
    if (votes.affirm > threshold) {
      this.consensusMsgTarget.textContent = 'approved'
      this.consensusMsgTarget.className = 'small text-green'
    } else if (votes.reject > threshold) {
      this.consensusMsgTarget.textContent = 'rejected'
      this.consensusMsgTarget.className = 'small text-danger'
    } else {
      this.consensusMsgTarget.textContent = ''
    }
  }

  _processBlock (blockData) {
    const ex = blockData.extra
    this.difficultyTarget.innerHTML = humanize.decimalParts(ex.difficulty, true, 0)
    this.bsubsidyPowTarget.innerHTML = humanize.decimalParts(ex.subsidy.pow / 100000000, false, 8, 2)
    this.bsubsidyPosTarget.innerHTML = humanize.decimalParts((ex.subsidy.pos / 500000000), false, 8, 2) // 5 votes per block (usually)
    this.bsubsidyDevTarget.innerHTML = humanize.decimalParts(ex.subsidy.dev / 100000000, false, 8, 2)
    this.coinSupplyTarget.innerHTML = humanize.decimalParts(ex.coin_supply / 100000000, true, 0)
    this.mixedPctTarget.innerHTML = ex.mixed_percent.toFixed(0)
    this.blocksdiffTarget.innerHTML = humanize.decimalParts(ex.sdiff, false, 8, 2)
    this.nextExpectedSdiffTarget.innerHTML = humanize.decimalParts(ex.next_expected_sdiff, false, 2, 2)
    this.nextExpectedMinTarget.innerHTML = humanize.decimalParts(ex.next_expected_min, false, 2, 2)
    this.nextExpectedMaxTarget.innerHTML = humanize.decimalParts(ex.next_expected_max, false, 2, 2)
    this.windowIndexTarget.textContent = ex.window_idx
    this.posBarTarget.style.width = `${(ex.window_idx / ex.params.window_size) * 100}%`
    this.poolSizeTarget.innerHTML = humanize.decimalParts(ex.pool_info.size, true, 0)
    this.targetPctTarget.textContent = parseFloat(ex.pool_info.percent_target - 100).toFixed(2)
    this.rewardIdxTarget.textContent = ex.reward_idx
    this.powBarTarget.style.width = `${(ex.reward_idx / ex.params.reward_window_size) * 100}%`
    this.poolValueTarget.innerHTML = humanize.decimalParts(ex.pool_info.value, true, 0)
    this.ticketRewardTarget.innerHTML = `${ex.reward.toFixed(2)}%`
    this.poolSizePctTarget.textContent = parseFloat(ex.pool_info.percent).toFixed(2)
    const treasuryTotal = ex.dev_fund + ex.treasury_bal.balance
    this.devFundTarget.innerHTML = humanize.decimalParts(treasuryTotal / 100000000, true, 0)
    if (ex.hash_rate > 0.001 && ex.hash_rate < 1) {
      ex.hash_rate = ex.hash_rate * 1000
    } else if (ex.hash_rate < 0.001) {
      ex.hash_rate = ex.hash_rate * 1000000
    }
    this.hashrateTarget.innerHTML = humanize.decimalParts(ex.hash_rate, false, 3, 2)
    this.hashrateDeltaTarget.innerHTML = humanize.fmtPercentage(ex.hash_rate_change_month)
    this.blockVotesTarget.dataset.hash = blockData.block.hash
    this.setVotes()
    const block = blockData.block
    this.blockHeightTarget.textContent = block.height
    this.blockHeightTarget.href = `/block/${block.hash}`
    this.blockSizeTarget.textContent = humanize.bytes(block.size)
    this.blockTotalTarget.textContent = humanize.threeSigFigs(block.total)

    if (ex.exchange_rate) {
      const xcRate = ex.exchange_rate.value
      const btcIndex = ex.exchange_rate.index
      if (this.hasPowConvertedTarget) {
        this.powConvertedTarget.textContent = `${humanize.twoDecimals(ex.subsidy.pow / 1e8 * xcRate)} ${btcIndex}`
      }
      if (this.hasConvertedDevTarget) {
        this.convertedDevTarget.textContent = `${humanize.threeSigFigs(treasuryTotal / 1e8 * xcRate)} ${btcIndex}`
      }
      if (this.hasConvertedSupplyTarget) {
        this.convertedSupplyTarget.textContent = `${humanize.threeSigFigs(ex.coin_supply / 1e8 * xcRate)} ${btcIndex}`
      }
      if (this.hasConvertedDevSubTarget) {
        this.convertedDevSubTarget.textContent = `${humanize.twoDecimals(ex.subsidy.dev / 1e8 * xcRate)} ${btcIndex}`
      }
      if (this.hasExchangeRateTarget) {
        this.exchangeRateTarget.textContent = humanize.twoDecimals(xcRate)
      }
      if (this.hasConvertedStakeTarget) {
        this.convertedStakeTarget.textContent = `${humanize.twoDecimals(ex.sdiff * xcRate)} ${btcIndex}`
      }
    }
  }
}
