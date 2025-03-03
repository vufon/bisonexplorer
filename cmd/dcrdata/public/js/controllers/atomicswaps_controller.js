import { Controller } from '@hotwired/stimulus'
import dompurify from 'dompurify'
import TurboQuery from '../helpers/turbolinks_helper'
import { requestJSON } from '../helpers/http'

const maxAddrRows = 160
let ctrl = null

export default class extends Controller {
  static get targets () {
    return ['pagesize', 'txnCount', 'paginator', 'pageplus', 'pageminus', 'listbox', 'table',
      'range', 'pagebuttons', 'listLoader', 'tablePagination', 'paginationheader', 'pair', 'status']
  }

  async connect () {
    ctrl = this
    ctrl.bindElements()
    ctrl.bindEvents()
    ctrl.query = new TurboQuery()

    // These two are templates for query parameter sets.
    // When url query parameters are set, these will also be updated.
    ctrl.settings = TurboQuery.nullTemplate(['n', 'start', 'pair', 'status'])
    // Get initial view settings from the url
    ctrl.query.update(ctrl.settings)
    ctrl.state = Object.assign({}, ctrl.settings)
    ctrl.settings.pair = ctrl.settings.pair && ctrl.settings.pair !== '' ? ctrl.settings.pair : 'all'
    ctrl.settings.status = ctrl.settings.status && ctrl.settings.status !== '' ? ctrl.settings.status : 'all'
    this.pairTarget.value = ctrl.settings.pair
    this.statusTarget.value = ctrl.settings.status
    // Parse stimulus data
    const cdata = ctrl.data
    ctrl.paginationParams = {
      offset: parseInt(cdata.get('offset')),
      count: parseInt(cdata.get('txnCount'))
    }
  }

  bindElements () {
    this.pageSizeOptions = this.hasPagesizeTarget ? this.pagesizeTarget.querySelectorAll('option') : []
  }

  bindEvents () {
    ctrl.paginatorTargets.forEach((link) => {
      link.addEventListener('click', (e) => {
        e.preventDefault()
      })
    })
  }

  changePair (e) {
    ctrl.settings.pair = (!e.target.value || e.target.value === '') ? 'all' : e.target.value
    this.fetchTable(this.pageSize, this.paginationParams.offset)
  }

  changeStatus (e) {
    ctrl.settings.status = (!e.target.value || e.target.value === '') ? 'all' : e.target.value
    this.fetchTable(this.pageSize, this.paginationParams.offset)
  }

  makeTableUrl (count, offset) {
    return `/atomicswaps-table?n=${count}&start=${offset}${ctrl.settings.pair && ctrl.settings.pair !== '' ? '&pair=' + ctrl.settings.pair : ''}${ctrl.settings.status && ctrl.settings.status !== '' ? '&status=' + ctrl.settings.status : ''}`
  }

  changePageSize () {
    this.fetchTable(this.pageSize, this.paginationParams.offset)
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
    this.fetchTable(pagesize, start)
  }

  toPage (direction) {
    const params = ctrl.paginationParams
    const count = ctrl.pageSize
    let requestedOffset = params.offset + count * direction
    if (requestedOffset >= params.count) return
    if (requestedOffset < 0) requestedOffset = 0
    ctrl.fetchTable(count, requestedOffset)
  }

  async fetchTable (count, offset) {
    ctrl.listLoaderTarget.classList.add('loading')
    const requestCount = count > 20 ? count : 20
    const tableResponse = await requestJSON(ctrl.makeTableUrl(requestCount, offset))
    ctrl.tableTarget.innerHTML = dompurify.sanitize(tableResponse.html)
    const settings = ctrl.settings
    settings.n = count
    settings.start = offset
    ctrl.paginationParams.count = tableResponse.tx_count
    ctrl.query.replace(settings)
    ctrl.paginationParams.offset = offset
    ctrl.paginationParams.pagesize = count
    ctrl.setPageability()
    ctrl.tablePaginationParams = tableResponse.pages
    ctrl.setTablePaginationLinks()
    ctrl.listLoaderTarget.classList.remove('loading')
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
    let links = ''

    if (typeof offset !== 'undefined' && offset > 0) {
      links = `<a href="/atomic-swaps?start=${offset - pageSize}&n=${pageSize} ` +
      'class="d-inline-block dcricon-arrow-left pagination-number pagination-narrow m-1 fz20" data-action="click->atomicswaps#pageNumberLink"></a>' + '\n'
    }

    links += tablePagesLink.map(d => {
      if (!d.link) return `<span>${d.str}</span>`
      return `<a href="${d.link}" class="fs18 pager pagination-number${d.active ? ' active' : ''}" data-action="click->atomicswaps#pageNumberLink">${d.str}</a>`
    }).join('\n')

    if ((txCount - offset) > pageSize) {
      links += '\n' + `<a href="/atomic-swaps?start=${(offset + pageSize)}&n=${pageSize} ` +
      'class="d-inline-block dcricon-arrow-right pagination-number pagination-narrow m-1 fs20" data-action="click->atomicswaps#pageNumberLink"></a>'
    }
    ctrl.tablePaginationTarget.innerHTML = dompurify.sanitize(links)
  }

  get pageSize () {
    const selected = this.pagesizeTarget.selectedOptions
    return selected.length ? parseInt(selected[0].value) : 20
  }
}
