import { Controller } from '@hotwired/stimulus'
import globalEventBus from '../services/event_bus_service'
import humanize from '../helpers/humanize_helper'
import TurboQuery from '../helpers/turbolinks_helper'
import Url from 'url-parse'

const conversionRate = 100000000

function newBlockHtmlElement (block) {
  let rewardTxId
  for (const tx of block.Transactions) {
    if (tx.Coinbase) {
      rewardTxId = tx.TxID
      break
    }
  }

  return `<div class="block visible">
                <div class="block-rows">
                    ${makeRewardsElement(block.Subsidy, block.MiningFee, block.Votes.length, rewardTxId)}
                    ${makeVoteElements(block.Votes)}
                    ${makeTicketAndRevocationElements(block.Tickets, block.Revocations, `/block/${block.Height}`)}
                    ${makeTransactionElements(block.Transactions, `/block/${block.Height}`)}
                </div>
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

function makeTxElement (tx, className, type, appendFlexGrow) {
  // const style = [ `opacity: ${(tx.VinCount + tx.VoutCount) / 10}` ];
  const style = []
  if (appendFlexGrow) {
    style.push(`flex-grow: ${Math.round(tx.Total)}`)
  }

  return `<span class="${className}" style="${style.join('; ')}" data-blocklist-target="tooltip"
                title='{"object": "${type}", "total": "${tx.Total}", "vout": "${tx.VoutCount}", "vin": "${tx.VinCount}"}'>
                <a class="block-element-link" href="/tx/${tx.TxID}"></a>
            </span>`
}

function makeVoteElements (votes) {
  let totalDCR = 0
  const voteLen = votes ? votes.length : 0
  const voteElements = []
  if (voteLen > 0) {
    for (let i = 0; i < voteLen - 1; i++) {
      const vote = votes[i]
      totalDCR += vote.Total
      voteElements.push(`<span style="background: ${vote.VoteValid ? 'linear-gradient(to right, #2971ff 0%, #528cff 100%)' : 'linear-gradient(to right, #fd714a 0%, #f6896a 100%)'}" data-blocklist-target="tooltip"
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
  <span class="pow" style="flex-grow: ${pow}" data-blocklist-target="tooltip"
      title='{"object": "PoW Reward", "total": "${pow}"}'>
      <span class="block-element-link">
          <span class="paint left-vs-block-data" ${backgroundColorRelativeToVotes}></span>
      </span>
  </span>
  <span class="pos" style="flex-grow: ${pos}" data-blocklist-target="tooltip"
      title='{"object": "PoS Reward", "total": "${pos}"}'>
      <span class="block-element-link">
          <span class="paint" ${backgroundColorRelativeToVotes}></span>
      </span>
  </span>
  <span class="fund" style="flex-grow: ${fund}" data-blocklist-target="tooltip"
      title='{"object": "Project Fund", "total": "${fund}"}'>
      <span class="block-element-link">
          <span class="paint" ${backgroundColorRelativeToVotes}></span>
      </span>
  </span>
  <span class="fees right-vs-block-data" style="flex-grow: ${fee}" data-blocklist-target="tooltip"
      title='{"object": "Tx Fees", "total": "${fee}"}'>
      <span class="block-element-link"></span>
  </span>
</div>`
}

export default class extends Controller {
  static get targets () {
    return ['table', 'txColHeader', 'voteColHeader', 'ticketColHeader', 'revColHeader',
      'txColData', 'voteColData', 'ticketColData', 'revColData', 'vsBlocksHeader',
      'vsSimulData', 'block', 'tooltip', 'txs', 'navLink', 'vsDescription']
  }

  async initialize () {
    this.query = new TurboQuery()
    this.settings = TurboQuery.nullTemplate(['vsdisp'])

    this.defaultSettings = {
      vsdisp: false
    }
    this.query.update(this.settings)
    this.settings.vsdisp = this.settings.vsdisp === true || this.settings.vsdisp === 'true'
    document.getElementById('vsBlocksToggle').checked = this.settings.vsdisp
  }

  connect () {
    this.processBlock = this._processBlock.bind(this)
    globalEventBus.on('BLOCK_RECEIVED', this.processBlock)
    this.pageOffset = this.data.get('initialOffset')
    this.initTableColumn()
    this.setupTooltips()
  }

  showVisualBlocks () {
    this.settings.vsdisp = !this.settings.vsdisp
    document.getElementById('vsBlocksToggle').checked = this.settings.vsdisp
    this.updateQueryString()
    this.updateVsHrefLink()
    this.initTableColumn()
  }

  updateVsHrefLink () {
    this.navLinkTargets.forEach((navLinkTarget) => {
      if (!navLinkTarget.href || navLinkTarget.href === '') {
        return
      }
      if (this.settings.vsdisp) {
        if (!navLinkTarget.href.includes('vsdisp')) {
          navLinkTarget.href = navLinkTarget.href + '&vsdisp=true'
        } else if (navLinkTarget.href.includes('vsdisp=false')) {
          navLinkTarget.href = navLinkTarget.href.replace('vsdisp=false', 'vsdisp=true')
        }
      } else {
        if (navLinkTarget.href && navLinkTarget.href.includes('vsdisp=true')) {
          if (navLinkTarget.href.includes('?vsdisp=true&')) {
            navLinkTarget.href = navLinkTarget.href.replace('vsdisp=true&', '')
          } else if (navLinkTarget.href.includes('&vsdisp=true')) {
            navLinkTarget.href = navLinkTarget.href.replace('&vsdisp=true', '')
          }
        }
      }
    })
  }

  initTableColumn () {
    if (this.settings.vsdisp) {
      this.txColHeaderTarget.classList.add('d-none-i')
      this.voteColHeaderTarget.classList.add('d-none-i')
      this.ticketColHeaderTarget.classList.add('d-none-i')
      this.revColHeaderTarget.classList.add('d-none-i')
      this.vsBlocksHeaderTarget.classList.remove('d-none-i')
      this.vsDescriptionTarget.classList.remove('d-none')

      this.txColDataTargets.forEach((txColDataTarget) => {
        txColDataTarget.classList.add('d-none-i')
      })
      this.voteColDataTargets.forEach((voteColDataTarget) => {
        voteColDataTarget.classList.add('d-none-i')
      })
      this.ticketColDataTargets.forEach((ticketColDataTarget) => {
        ticketColDataTarget.classList.add('d-none-i')
      })
      this.revColDataTargets.forEach((revColDataTarget) => {
        revColDataTarget.classList.add('d-none-i')
      })
      this.vsSimulDataTargets.forEach((vsSimulDataTarget) => {
        vsSimulDataTarget.classList.remove('d-none-i')
      })
    } else {
      this.txColHeaderTarget.classList.remove('d-none-i')
      this.voteColHeaderTarget.classList.remove('d-none-i')
      this.ticketColHeaderTarget.classList.remove('d-none-i')
      this.revColHeaderTarget.classList.remove('d-none-i')
      this.vsBlocksHeaderTarget.classList.add('d-none-i')
      this.vsDescriptionTarget.classList.add('d-none')

      this.txColDataTargets.forEach((txColDataTarget) => {
        txColDataTarget.classList.remove('d-none-i')
      })
      this.voteColDataTargets.forEach((voteColDataTarget) => {
        voteColDataTarget.classList.remove('d-none-i')
      })
      this.ticketColDataTargets.forEach((ticketColDataTarget) => {
        ticketColDataTarget.classList.remove('d-none-i')
      })
      this.revColDataTargets.forEach((revColDataTarget) => {
        revColDataTarget.classList.remove('d-none-i')
      })
      this.vsSimulDataTargets.forEach((vsSimulDataTarget) => {
        vsSimulDataTarget.classList.add('d-none-i')
      })
    }
  }

  setupTooltips () {
    // check for empty tx rows and set custom tooltip
    this.txsTargets.forEach((div) => {
      if (div.childeElementCount === 0) {
        div.title = 'No regular transaction in block'
      }
    })

    this.tooltipTargets.forEach((tooltipElement) => {
      try {
        // parse the content
        const data = JSON.parse(tooltipElement.title)
        let newContent
        if (data.object === 'Vote') {
          newContent = `<b>${data.object} (${data.voteValid ? 'Yes' : 'No'})</b>`
        } else {
          newContent = `<b>${data.object}</b><br>${humanize.decimalParts(data.total, false, 8, 2)} DCR`
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
    globalEventBus.off('BLOCK_RECEIVED', this.processBlock)
  }

  _processBlock (blockData) {
    if (!this.hasTableTarget) return
    const block = blockData.block
    // Grab a copy of the first row.
    const rows = this.tableTarget.querySelectorAll('tr')
    if (rows.length === 0) return
    const tr = rows[0]
    const lastHeight = parseInt(tr.dataset.height)
    // Make sure this block belongs on the top of this table.
    if (block.height === lastHeight) {
      this.tableTarget.removeChild(tr)
    } else if (block.height === lastHeight + 1) {
      this.tableTarget.removeChild(rows[rows.length - 1])
    } else return
    // Set the td contents based on the order of the existing row.
    const newRow = document.createElement('tr')
    newRow.dataset.height = block.height
    newRow.dataset.linkClass = tr.dataset.linkClass
    const tds = tr.querySelectorAll('td')
    const _this = this
    tds.forEach((td) => {
      const newTd = document.createElement('td')
      newTd.className = td.className
      const dataType = td.dataset.type
      newTd.dataset.type = dataType
      switch (dataType) {
        case 'age':
          newTd.dataset.age = block.unixStamp
          newTd.dataset.timeTarget = 'age'
          newTd.textContent = humanize.timeSince(block.unixStamp)
          break
        case 'height': {
          const link = document.createElement('a')
          link.href = `/block/${block.height}`
          link.textContent = block.height
          link.classList.add(tr.dataset.linkClass)
          newTd.appendChild(link)
          break
        }
        case 'size':
          newTd.textContent = humanize.bytes(block.size)
          break
        case 'value':
          newTd.textContent = humanize.threeSigFigs(block.TotalSent)
          break
        case 'time':
          newTd.textContent = humanize.date(block.time, false)
          break
        case 'vssimulation':
          newTd.innerHTML = _this.createNewVsBlock(block)
          break
        default:
          newTd.textContent = block[dataType]
      }
      newRow.appendChild(newTd)
    })
    this.tableTarget.insertBefore(newRow, this.tableTarget.firstChild)
    this.setupTooltips()
  }

  createNewVsBlock (block) {
    // show only regular tx in block.Transactions, exclude coinbase (reward) transactions
    const transactions = block.Tx.filter(tx => !tx.Coinbase)
    // trim unwanted data in this block
    const trimmedBlockInfo = {
      Time: block.time,
      Height: block.height,
      Total: block.TotalSent,
      MiningFee: block.MiningFee,
      Subsidy: block.Subsidy,
      Votes: block.Votes,
      Tickets: block.Tickets,
      Revocations: block.Revs,
      Transactions: transactions
    }
    return newBlockHtmlElement(trimmedBlockInfo)
  }

  updateQueryString () {
    const url = Url(window.location.href)
    const q = Url.qs.parse(url.query)
    for (const k in this.settings) {
      q[k] = this.settings[k]
    }
    const [query, settings, defaults] = [{}, q, this.defaultSettings]
    for (const k in settings) {
      if (!settings[k] || (defaults[k] && settings[k].toString() === defaults[k].toString())) continue
      query[k] = settings[k]
    }
    this.query.replace(query)
  }
}
