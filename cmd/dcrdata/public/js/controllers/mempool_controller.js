import { Controller } from '@hotwired/stimulus'
import { map, each } from 'lodash-es'
import dompurify from 'dompurify'
import humanize from '../helpers/humanize_helper'
import ws from '../services/messagesocket_service'
import { keyNav } from '../services/keyboard_navigation_service'
import Mempool from '../helpers/mempool_helper'
import { copyIcon, alertArea } from './clipboard_controller'
const conversionRate = 100000000

function incrementValue (el) {
  if (!el) return
  el.textContent = parseInt(el.textContent) + 1
}

function rowNode (rowText) {
  const tbody = document.createElement('tbody')
  tbody.innerHTML = rowText
  dompurify.sanitize(tbody, { IN_PLACE: true, FORBID_TAGS: ['svg', 'math'] })
  return tbody.firstElementChild
}

function txTableRow (tx) {
  return rowNode(`<tr class="flash">
        <td class="break-word clipboard">
          <a class="hash" href="/tx/${tx.hash}" title="${tx.hash}">${tx.hash}</a>
          ${copyIcon()}
          ${alertArea()}
        </td>
        <td class="mono fs15 text-end">${humanize.decimalParts(tx.total, false, 8)}</td>
        <td class="mono fs15 text-end">${tx.size} B</td>
        <td class="mono fs15 text-end">${tx.fee_rate} DCR/kB</td>
        <td class="mono fs15 text-end" data-time-target="age" data-age="${tx.time}">${humanize.timeSince(tx.time)}</td>
    </tr>`)
}

function treasuryTxTableRow (tx) {
  return rowNode(`<tr class="flash">
        <td class="break-word clipboard">
          <a class="hash" href="/tx/${tx.hash}" title="${tx.hash}">${tx.hash}</a>
          ${copyIcon()}
          ${alertArea()}
        </td>
        <td class="mono fs15 text-end">${humanize.decimalParts(tx.total, false, 8)}</td>
        <td class="mono fs15 text-end" data-time-target="age" data-age="${tx.time}">${humanize.timeSince(tx.time)}</td>
    </tr>`)
}

function voteTxTableRow (tx) {
  return rowNode(`<tr class="flash" data-height="${tx.vote_info.block_validation.height}" data-blockhash="${tx.vote_info.block_validation.hash}">
        <td class="break-word clipboard">
          <a class="hash" href="/tx/${tx.hash}">${tx.hash}</a>
          ${copyIcon()}
          ${alertArea()}
        </td>
        <td class="mono fs15"><a href="/block/${tx.vote_info.block_validation.hash}">${tx.vote_info.block_validation.height}<span
          class="small">${tx.vote_info.last_block ? ' best' : ''}</span></a></td>
        <td class="mono fs15 text-end"><a href="/tx/${tx.vote_info.ticket_spent}">${tx.vote_info.mempool_ticket_index}<a/></td>
        <td class="mono fs15 text-end">${tx.vote_info.vote_version}</td>
        <td class="mono fs15 text-end d-none d-sm-table-cell">${humanize.decimalParts(tx.total, false, 8)}</td>
        <td class="mono fs15 text-end">${humanize.bytes(tx.size)}</td>
        <td class="mono fs15 text-end d-none d-sm-table-cell jsonly" data-time-target="age" data-age="${tx.time}">${humanize.timeSince(tx.time)}</td>
    </tr>`)
}

function buildTable (target, txType, txns, rowFn) {
  while (target.firstChild) target.removeChild(target.firstChild)
  if (txns && txns.length > 0) {
    map(txns, rowFn).forEach((tr) => {
      target.appendChild(tr)
    })
  } else {
    target.innerHTML = `<tr class="no-tx-tr"><td colspan="${(txType === 'votes' ? 8 : 4)}">No ${txType} in mempool.</td></tr>`
  }
}

function addTxRow (tx, target, rowFn) {
  if (target.childElementCount === 1 && target.firstElementChild.classList.contains('no-tx-tr')) {
    target.removeChild(target.firstElementChild)
  }
  target.insertBefore(rowFn(tx), target.firstChild)
}

function makeRewardsElement (subsidy, fee, voteCount, rewardTxId) {
  if (!subsidy) {
    return `<div class="block-rewards">
                    <span class="pow"><span class="paint" style="width:100%;"></span></span>
                    <span class="pos"><span class="paint" style="width:100%;"></span></span>
                    <span class="fund"><span class="paint" style="width:100%;"></span></span>
                    <span class="fees" title='{"object": "Tx Fees", "total": "${fee}"}'></span>
                </div>`
  }

  const pow = subsidy.pow / conversionRate
  const pos = subsidy.pos / conversionRate
  const fund = (subsidy.developer || subsidy.dev) / conversionRate

  const backgroundColorRelativeToVotes = `style="width: ${voteCount * 20}%"` // 5 blocks = 100% painting

  // const totalDCR = Math.round(pow + fund + fee);
  const totalDCR = 1
  return `<div class="block-rewards" style="flex-grow: ${totalDCR}">
                <span class="pow" style="flex-grow: ${pow}" data-mempool-target="tooltip"
                    title='{"object": "PoW Reward", "total": "${pow}"}'>
                    <a class="block-element-link" href="/tx/${rewardTxId}">
                        <span class="paint" ${backgroundColorRelativeToVotes}></span>
                    </a>
                </span>
                <span class="pos" style="flex-grow: ${pos}" data-mempool-target="tooltip"
                    title='{"object": "PoS Reward", "total": "${pos}"}'>
                    <a class="block-element-link" href="/tx/${rewardTxId}">
                        <span class="paint" ${backgroundColorRelativeToVotes}></span>
                    </a>
                </span>
                <span class="fund" style="flex-grow: ${fund}" data-mempool-target="tooltip"
                    title='{"object": "Project Fund", "total": "${fund}"}'>
                    <a class="block-element-link" href="/tx/${rewardTxId}">
                        <span class="paint" ${backgroundColorRelativeToVotes}></span>
                    </a>
                </span>
                <span class="fees" style="flex-grow: ${fee}" data-mempool-target="tooltip"
                    title='{"object": "Tx Fees", "total": "${fee}"}'>
                    <a class="block-element-link" href="/tx/${rewardTxId}"></a>
                </span>
            </div>`
}

function makeVoteElements (votes) {
  let totalDCR = 0
  const voteElements = (votes || []).map(vote => {
    totalDCR += vote.Total
    return `<span style="background-color: ${vote.VoteValid ? '#2971ff' : 'rgba(253, 113, 74, 0.8)'}" data-mempool-target="tooltip"
                    title='{"object": "Vote", "total": "${vote.Total}", "voteValid": "${vote.VoteValid}"}'>
                    <a class="block-element-link" href="/tx/${vote.TxID}"></a>
                </span>`
  })

  // append empty squares to votes
  for (let i = voteElements.length; i < 5; i++) {
    voteElements.push('<span title="Empty vote slot"></span>')
  }

  // totalDCR = Math.round(totalDCR);
  totalDCR = 1
  return `<div class="block-votes" style="flex-grow: ${totalDCR}">
                ${voteElements.join('\n')}
            </div>`
}

function makeTicketAndRevocationElements (tickets, revocations, blockHref) {
  let totalDCR = 0

  const ticketElements = (tickets || []).map(ticket => {
    totalDCR += ticket.Total
    return makeTxElement(ticket, 'block-ticket', 'Ticket')
  })
  if (ticketElements.length > 50) {
    const total = ticketElements.length
    ticketElements.splice(30)
    ticketElements.push(`<span class="block-ticket" style="flex-grow: 10; flex-basis: 50px;" title="Total of ${total} tickets">
                                <a class="block-element-link" href="${blockHref}">+ ${total - 30}</a>
                            </span>`)
  }
  const revocationElements = (revocations || []).map(revocation => {
    totalDCR += revocation.Total
    return makeTxElement(revocation, 'block-rev', 'Revocation')
  })

  const ticketsAndRevocationElements = ticketElements.concat(revocationElements)

  // append empty squares to tickets+revs
  for (let i = ticketsAndRevocationElements.length; i < 20; i++) {
    ticketsAndRevocationElements.push('<span title="Empty ticket slot"></span>')
  }

  // totalDCR = Math.round(totalDCR);
  totalDCR = 1
  return `<div class="block-tickets" style="flex-grow: ${totalDCR}">
                ${ticketsAndRevocationElements.join('\n')}
            </div>`
}

function makeTxElement (tx, className, type, appendFlexGrow) {
  // const style = [ `opacity: ${(tx.VinCount + tx.VoutCount) / 10}` ];
  const style = []
  if (appendFlexGrow) {
    style.push(`flex-grow: ${Math.round(tx.Total)}`)
  }

  return `<span class="${className}" style="${style.join('; ')}" data-mempool-target="tooltip"
                title='{"object": "${type}", "total": "${tx.Total}", "vout": "${tx.VoutCount}", "vin": "${tx.VinCount}"}'>
                <a class="block-element-link" href="/tx/${tx.TxID}"></a>
            </span>`
}

function makeTransactionElements (transactions, blockHref) {
  let totalDCR = 0
  const transactionElements = (transactions || []).map(tx => {
    totalDCR += tx.Total
    return makeTxElement(tx, 'block-tx', 'Transaction', true)
  })

  if (transactionElements.length > 50) {
    const total = transactionElements.length
    transactionElements.splice(30)
    transactionElements.push(`<span class="block-tx" style="flex-grow: 10; flex-basis: 50px;" title="Total of ${total} transactions">
                                    <a class="block-element-link" href="${blockHref}">+ ${total - 30}</a>
                                </span>`)
  }

  // totalDCR = Math.round(totalDCR);
  totalDCR = 1
  return `<div class="block-transactions" style="flex-grow: ${totalDCR}">
                ${transactionElements.join('\n')}
            </div>`
}

function makeMempoolBlock (block) {
  let fees = 0
  if (!block.Transactions) return
  for (const tx of block.Transactions) {
    fees += tx.Fees
  }

  return `<div class="block-info">
                    <span class="color-code">Visual simulation</span>
                    <div class="mono amount" style="line-height: 1;">${Math.floor(block.Total)} DCR</div>
                    <span class="timespan">
                        <span data-time-target="age" data-age="${block.Time}"></span>
                    </span>
                </div>
                <div class="block-rows">
                    ${makeRewardsElement(block.Subsidy, fees, block.Votes.length, '#')}
                    ${makeVoteElements(block.Votes)}
                    ${makeTicketAndRevocationElements(block.Tickets, block.Revocations, '/mempool')}
                    ${makeTransactionElements(block.Transactions, '/mempool')}
                </div>`
}

export default class extends Controller {
  static get targets () {
    return [
      'bestBlock',
      'bestBlockTime',
      'tspendTransactions',
      'taddTransactions',
      'voteTransactions',
      'ticketTransactions',
      'revocationTransactions',
      'regularTransactions',
      'mempool',
      'voteTally',
      'regTotal',
      'regCount',
      'ticketTotal',
      'ticketCount',
      'voteTotal',
      'voteCount',
      'revTotal',
      'revCount',
      'likelyTotal',
      'mempoolSize',
      'memBlock',
      'tooltip'
    ]
  }

  connect () {
    // from txhelpers.DetermineTxTypeString
    const mempoolData = this.mempoolTarget.dataset
    ws.send('getmempooltxs', mempoolData.id)
    this.mempool = new Mempool(mempoolData, this.voteTallyTargets)
    this.txTargetMap = {
      'Treasury Spend': this.tspendTransactionsTarget,
      Vote: this.voteTransactionsTarget,
      Ticket: this.ticketTransactionsTarget,
      Revocation: this.revocationTransactionsTarget,
      Regular: this.regularTransactionsTarget
    }
    if (this.hasTaddTransactionsTarget) this.txTargetMap['Treasury Add'] = this.taddTransactionsTarget
    this.countTargetMap = {
      Vote: this.numVoteTarget,
      Ticket: this.numTicketTarget,
      Revocation: this.numRevocationTarget,
      Regular: this.numRegularTarget
    }
    ws.registerEvtHandler('newtxs', (evt) => {
      const txs = JSON.parse(evt)
      this.mempool.mergeTxs(txs)
      this.renderNewTxns(txs)
      this.setMempoolFigures()
      this.labelVotes()
      this.sortVotesTable()
      keyNav(evt, false, true)
      ws.send('getmempooltrimmed', '')
    })
    ws.registerEvtHandler('mempool', (evt) => {
      const m = JSON.parse(evt)
      this.mempool.replace(m)
      this.setMempoolFigures()
      this.updateBlock(m)
      ws.send('getmempooltxs', '')
      ws.send('getmempooltrimmed', '')
    })
    ws.registerEvtHandler('getmempooltxsResp', (evt) => {
      const m = JSON.parse(evt)
      this.mempool.replace(m)
      this.handleTxsResp(m)
      this.setMempoolFigures()
      this.labelVotes()
      this.sortVotesTable()
      keyNav(evt, false, true)
    })
    ws.registerEvtHandler('getmempooltrimmedResp', (event) => {
      this.handleMempoolUpdate(event)
    })
    this.setupTooltips()
  }

  disconnect () {
    ws.deregisterEvtHandlers('newtxs')
    ws.deregisterEvtHandlers('mempool')
    ws.deregisterEvtHandlers('getmempooltxsResp')
    ws.deregisterEvtHandlers('getmempooltrimmedResp')
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

  updateBlock (m) {
    this.bestBlockTarget.textContent = m.block_height
    this.bestBlockTarget.dataset.hash = m.block_hash
    this.bestBlockTarget.href = `/block/${m.block_hash}`
    this.bestBlockTimeTarget.dataset.age = m.block_time
  }

  setMempoolFigures () {
    const totals = this.mempool.totals()
    const counts = this.mempool.counts()
    this.regTotalTarget.textContent = humanize.threeSigFigs(totals.regular)
    this.regCountTarget.textContent = counts.regular

    this.ticketTotalTarget.textContent = humanize.threeSigFigs(totals.ticket)
    this.ticketCountTarget.textContent = counts.ticket

    this.voteTotalTarget.textContent = humanize.threeSigFigs(totals.vote)

    const ct = this.voteCountTarget
    while (ct.firstChild) ct.removeChild(ct.firstChild)
    this.mempool.voteSpans(counts.vote).forEach((span) => { ct.appendChild(span) })

    this.revTotalTarget.textContent = humanize.threeSigFigs(totals.rev)
    this.revCountTarget.textContent = counts.rev

    this.likelyTotalTarget.textContent = humanize.threeSigFigs(totals.total)
    this.mempoolSizeTarget.textContent = humanize.bytes(totals.size)

    this.labelVotes()
    // this.setVotes()
  }

  handleTxsResp (m) {
    buildTable(this.regularTransactionsTarget, 'regular transactions', m.tx, txTableRow)
    buildTable(this.revocationTransactionsTarget, 'revocations', m.revs, txTableRow)
    buildTable(this.voteTransactionsTarget, 'votes', m.votes, voteTxTableRow)
    buildTable(this.ticketTransactionsTarget, 'tickets', m.tickets, txTableRow)
    buildTable(this.tspendTransactionsTarget, 'tspends', m.tspends, treasuryTxTableRow)
    if (this.hasTaddTransactionsTarget) buildTable(this.taddTransactionsTarget, 'tadds', m.tadds, treasuryTxTableRow)
  }

  renderNewTxns (txs) {
    each(txs, (tx) => {
      incrementValue(this.countTargetMap[tx.Type])
      let rowFn
      switch (tx.Type) {
        case 'Vote':
          rowFn = voteTxTableRow
          break
        case 'Treasury Spend':
          rowFn = treasuryTxTableRow
          break
        case 'Treasury Add':
          if (!this.hasTaddTransactionsTarget) return
          rowFn = treasuryTxTableRow
          break
        default:
          rowFn = txTableRow
      }
      addTxRow(tx, this.txTargetMap[tx.Type], rowFn)
    })
  }

  labelVotes () {
    const bestBlockHash = this.bestBlockTarget.dataset.hash
    const bestBlockHeight = parseInt(this.bestBlockTarget.textContent)
    this.voteTransactionsTarget.querySelectorAll('tr').forEach((tr) => {
      const voteValidationHash = tr.dataset.blockhash
      const voteBlockHeight = tr.dataset.height
      const best = tr.querySelector('.small')
      if (!best) return // Just the "No votes in mempool." td?
      best.textContent = ''
      if (voteBlockHeight > bestBlockHeight) {
        tr.classList.add('blue-row')
        tr.classList.remove('disabled-row')
      } else if (voteValidationHash !== bestBlockHash) {
        tr.classList.add('disabled-row')
        tr.classList.remove('blue-row')
        if (tr.classList.contains('last_block')) {
          tr.textContent = 'False'
        }
      } else {
        tr.classList.remove('disabled-row')
        tr.classList.remove('blue-row')
        best.textContent = ' (best)'
      }
    })
  }

  sortVotesTable () {
    const rows = Array.from(this.voteTransactionsTarget.querySelectorAll('tr'))
    rows.sort(function (a, b) {
      if (a.dataset.height === b.dataset.height) {
        const indexA = parseInt(a.dataset.ticketIndex)
        const indexB = parseInt(b.dataset.ticketIndex)
        return (indexA - indexB)
      } else {
        return (b.dataset.height - a.dataset.height)
      }
    })
    this.voteTransactionsTarget.innerHTML = ''
    rows.forEach((row) => { this.voteTransactionsTarget.appendChild(row) })
  }
}
