import { Controller } from '@hotwired/stimulus'
import dompurify from 'dompurify'
import { getDefault } from '../helpers/module_helper.js'
import globalEventBus from '../services/event_bus_service.js'
import TurboQuery from '../helpers/turbolinks_helper.js'
import humanize from '../helpers/humanize_helper.js'
import txInBlock from '../helpers/block_helper.js'
import { fadeIn, animationFrame } from '../helpers/animation_helper.js'
import { requestJSON } from '../helpers/http.js'

const maxAddrRows = 160
function setTxnCountText (el, count) {
  if (el.dataset.formatted) {
    el.textContent = count + ' transaction' + (count > 1 ? 's' : '')
  } else {
    el.textContent = count
  }
}

let ctrl = null

export default class extends Controller {
  static get targets () {
    return ['addr', 'balance',
      'numUnconfirmed',
      'pagesize', 'txnCount', 'qricon', 'qrimg', 'qrbox',
      'paginator', 'pageplus', 'pageminus', 'listbox', 'table',
      'range', 'noconfirms', 'pagebuttons',
      'pending', 'hash', 'matchhash', 'view', 'listLoader',
      'tablePagination', 'paginationheader']
  }

  async connect () {
    ctrl = this
    ctrl.retrievedData = {}
    ctrl.ajaxing = false
    ctrl.qrCode = false
    ctrl.requestedChart = false
    ctrl.lastEnd = 0
    ctrl.confirmMempoolTxs = ctrl._confirmMempoolTxs.bind(ctrl)
    ctrl.bindElements()
    ctrl.bindEvents()
    ctrl.query = new TurboQuery()

    // These two are templates for query parameter sets.
    // When url query parameters are set, these will also be updated.
    const settings = ctrl.settings = TurboQuery.nullTemplate(['n', 'start', 'txntype'])
    ctrl.state = Object.assign({}, settings)
    // Parse stimulus data
    const cdata = ctrl.data
    ctrl.dcrAddress = cdata.get('dcraddress')
    ctrl.chainType = cdata.get('chainType')
    ctrl.paginationParams = {
      offset: parseInt(cdata.get('offset')),
      count: parseInt(cdata.get('txnCount'))
    }
    ctrl.balance = cdata.get('balance')

    // Get initial view settings from the url
    ctrl.query.update(settings)
  }

  disconnect () {
    globalEventBus.off('BLOCK_RECEIVED', this.confirmMempoolTxs)
    this.retrievedData = {}
  }

  bindElements () {
    this.pageSizeOptions = this.hasPagesizeTarget ? this.pagesizeTarget.querySelectorAll('option') : []
  }

  bindEvents () {
    globalEventBus.on('BLOCK_RECEIVED', this.confirmMempoolTxs)
    ctrl.paginatorTargets.forEach((link) => {
      link.addEventListener('click', (e) => {
        e.preventDefault()
      })
    })
  }

  async showQRCode () {
    this.qrboxTarget.classList.remove('d-hide')
    if (this.qrCode) {
      await fadeIn(this.qrimgTarget)
    } else {
      const QRCode = await getDefault(
        import(/* webpackChunkName: "qrcode" */ 'qrcode')
      )
      const qrCodeImg = await QRCode.toDataURL(this.dcrAddress,
        {
          errorCorrectionLevel: 'H',
          scale: 6,
          margin: 0
        }
      )
      this.qrimgTarget.innerHTML = `<img src="${qrCodeImg}"/>`
      await fadeIn(this.qrimgTarget)
      if (this.graph) this.graph.resize()
    }
    this.qriconTarget.classList.add('d-hide')
  }

  async hideQRCode () {
    this.qriconTarget.classList.remove('d-hide')
    this.qrboxTarget.classList.add('d-hide')
    this.qrimgTarget.style.opacity = 0
    await animationFrame()
  }

  makeTableUrl (txType, count, offset) {
    const root = `${this.chainType}/addresstable/${this.dcrAddress}`
    return `/${root}?txntype=${txType}&n=${count}&start=${offset}`
  }

  changePageSize () {
    this.fetchTableWithPeriod('all', this.pageSize, this.paginationParams.offset)
  }

  nextPage () {
    this.toPage(1)
  }

  prevPage () {
    this.toPage(-1)
  }

  pageNumberLink (e) {
    e.preventDefault()
    const url = e.target.href
    const parser = new URL(url)
    const start = parser.searchParams.get('start')
    const pagesize = parser.searchParams.get('n')
    const txntype = parser.searchParams.get('txntype')
    this.fetchTableWithPeriod(txntype, pagesize, start)
  }

  toPage (direction) {
    const params = ctrl.paginationParams
    const count = ctrl.pageSize
    const txType = ctrl.txnType
    let requestedOffset = params.offset + count * direction
    if (requestedOffset >= params.count) return
    if (requestedOffset < 0) requestedOffset = 0
    ctrl.fetchTableWithPeriod(txType, count, requestedOffset)
  }

  async fetchTableWithPeriod (txType, count, offset) {
    ctrl.listLoaderTarget.classList.add('loading')
    const requestCount = count > 20 ? count : 20
    const tableResponse = await requestJSON(ctrl.makeTableUrl(txType, requestCount, offset))
    ctrl.tableTarget.innerHTML = dompurify.sanitize(tableResponse.html)
    const settings = ctrl.settings
    settings.n = count
    settings.start = offset
    settings.txntype = txType
    ctrl.paginationParams.count = tableResponse.tx_count
    ctrl.query.replace(settings)
    ctrl.paginationParams.offset = offset
    ctrl.paginationParams.pagesize = count
    ctrl.paginationParams.txntype = txType
    ctrl.setPageability()
    ctrl.tablePaginationParams = tableResponse.pages
    ctrl.setTablePaginationLinks()
    ctrl.listLoaderTarget.classList.remove('loading')
  }

  async fetchTable (txType, count, offset) {
    this.fetchTableWithPeriod(txType, count, offset, '')
  }

  setPageability () {
    const params = ctrl.paginationParams
    const rowMax = params.count
    const count = ctrl.pageSize
    if (ctrl.paginationParams.count === 0) {
      ctrl.paginationheaderTarget.classList.add('d-hide')
    } else {
      ctrl.paginationheaderTarget.classList.remove('d-hide')
    }
    if (rowMax > count) {
      ctrl.pagebuttonsTarget.classList.remove('d-hide')
    } else {
      ctrl.pagebuttonsTarget.classList.add('d-hide')
    }
    const setAbility = (el, state) => {
      if (state) {
        el.classList.remove('disabled')
      } else {
        el.classList.add('disabled')
      }
    }
    setAbility(ctrl.pageplusTarget, params.offset + count < rowMax)
    setAbility(ctrl.pageminusTarget, params.offset - count >= 0)
    ctrl.pageSizeOptions.forEach((option) => {
      if (option.value > 100) {
        if (rowMax > 100) {
          option.disabled = false
          option.text = option.value = Math.min(rowMax, maxAddrRows)
        } else {
          option.disabled = true
          option.text = option.value = maxAddrRows
        }
      } else {
        option.disabled = rowMax <= option.value
      }
    })
    setAbility(ctrl.pagesizeTarget, rowMax > 20)
    const suffix = rowMax > 1 ? 's' : ''
    let rangeEnd = params.offset + count
    if (rangeEnd > rowMax) rangeEnd = rowMax
    ctrl.rangeTarget.innerHTML = 'showing ' + (params.offset + 1) + ' &ndash; ' +
    rangeEnd + ' of ' + rowMax.toLocaleString() + ' transaction' + suffix
  }

  setTablePaginationLinks () {
    const tablePagesLink = ctrl.tablePaginationParams
    if (tablePagesLink.length === 0) return ctrl.tablePaginationTarget.classList.add('d-hide')
    ctrl.tablePaginationTarget.classList.remove('d-hide')
    const txCount = parseInt(ctrl.paginationParams.count)
    const offset = parseInt(ctrl.paginationParams.offset)
    const pageSize = parseInt(ctrl.paginationParams.pagesize)
    const txnType = ctrl.paginationParams.txntype
    let links = ''

    const root = this.dcrAddress === `${this.chainType}/address/${this.dcrAddress}`

    if (typeof offset !== 'undefined' && offset > 0) {
      links = `<a href="/${root}?start=${offset - pageSize}&n=${pageSize}&txntype=${txnType}" ` +
      'class="d-inline-block dcricon-arrow-left pagination-number pagination-narrow m-1 fz20" data-action="click->address#pageNumberLink"></a>' + '\n'
    }

    links += tablePagesLink.map(d => {
      if (!d.link) return `<span>${d.str}</span>`
      return `<a href="${d.link}" class="fs18 pager pagination-number${d.active ? ' active' : ''}" data-action="click->address#pageNumberLink">${d.str}</a>`
    }).join('\n')

    if ((txCount - offset) > pageSize) {
      links += '\n' + `<a href="/${root}?start=${(offset + pageSize)}&n=${pageSize}&txntype=${txnType}" ` +
      'class="d-inline-block dcricon-arrow-right pagination-number pagination-narrow m-1 fs20" data-action="click->address#pageNumberLink"></a>'
    }

    ctrl.tablePaginationTarget.innerHTML = dompurify.sanitize(links)
  }

  _confirmMempoolTxs (blockData) {
    const block = blockData.block
    if (this.hasPendingTarget) {
      this.pendingTargets.forEach((row) => {
        if (txInBlock(row.dataset.txid, block)) {
          const confirms = row.querySelector('td.addr-tx-confirms')
          confirms.textContent = '1'
          confirms.dataset.confirmationBlockHeight = block.height
          row.querySelector('td.addr-tx-time').textContent = humanize.date(block.time, true)
          const age = row.querySelector('td.addr-tx-age > span')
          age.dataset.age = block.time
          age.textContent = humanize.timeSince(block.unixStamp)
          delete row.dataset.addressTarget
          // Increment the displayed tx count
          const count = this.txnCountTarget
          count.dataset.txnCount++
          setTxnCountText(count, count.dataset.txnCount)
          this.numUnconfirmedTargets.forEach((tr, i) => {
            const td = tr.querySelector('td.addr-unconfirmed-count')
            let count = parseInt(tr.dataset.count)
            if (count) count--
            tr.dataset.count = count
            if (count === 0) {
              tr.classList.add('.d-hide')
              delete tr.dataset.addressTarget
            } else {
              td.textContent = count
            }
          })
        }
      })
    }
  }

  get pageSize () {
    const selected = this.pagesizeTarget.selectedOptions
    return selected.length ? parseInt(selected[0].value) : 20
  }
}
