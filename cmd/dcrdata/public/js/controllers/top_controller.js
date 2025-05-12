import { Controller } from '@hotwired/stimulus'
import humanize from '../helpers/humanize_helper'
import globalEventBus from '../services/event_bus_service'

export default class extends Controller {
  static get targets () {
    return ['difficulty', 'blockHeight', 'blockTime', 'supportedTable', 'sortIcon']
  }

  connect () {
    const activeChainStr = this.data.get('activeChain')
    if (!activeChainStr || activeChainStr === '') {
      return
    }
    this.activeChainArr = activeChainStr.split(',')
    this.currentSort = { column: 'cap', direction: 'desc' }
    this.updateIcons()
    this.sortTable()
    const _this = this
    this.activeChainArr.forEach(activeChain => {
      if (!activeChain || activeChain === '') {
        return
      }
      switch (activeChain) {
        case 'dcr':
          _this.processBlock = _this._processBlock.bind(_this)
          globalEventBus.on('BLOCK_RECEIVED', _this.processBlock)
          break
        case 'ltc':
          _this.processLTCBlock = _this._processLTCBlock.bind(_this)
          globalEventBus.on('LTC_BLOCK_RECEIVED', _this.processLTCBlock)
          break
        case 'btc':
          _this.processBTCBlock = _this._processBTCBlock.bind(_this)
          globalEventBus.on('BTC_BLOCK_RECEIVED', _this.processBTCBlock)
      }
    })
  }

  disconnect () {
    const _this = this
    this.activeChainArr.forEach(activeChain => {
      if (!activeChain || activeChain === '') {
        return
      }
      switch (activeChain) {
        case 'dcr':
          globalEventBus.off('BLOCK_RECEIVED', _this.processBlock)
          break
        case 'ltc':
          globalEventBus.off('LTC_BLOCK_RECEIVED', _this.processLTCBlock)
          break
        case 'btc':
          globalEventBus.off('BTC_BLOCK_RECEIVED', _this.processBTCBlock)
      }
    })
  }

  _processBlock (blockData) {
    this.processMutilchainBlock(blockData, 'dcr')
  }

  _processLTCBlock (blockData) {
    this.processMutilchainBlock(blockData, 'ltc')
  }

  _processBTCBlock (blockData) {
    this.processMutilchainBlock(blockData, 'btc')
  }

  processMutilchainBlock (blockData, chainType) {
    const blockHeightObj = document.getElementById(chainType + '_blockHeight')
    const txCountObj = document.getElementById(chainType + '_txcount')
    const coinSupplyObj = document.getElementById(chainType + '_coinSupply')
    const block = blockData.block
    blockHeightObj.textContent = block.height
    blockHeightObj.href = (chainType === 'dcr' ? '' : '/' + chainType) + `/block/${block.hash}`

    // handler extra data
    const extra = blockData.extra
    if (!extra) {
      return
    }
    txCountObj.textContent = humanize.commaWithDecimal(extra.total_transactions, 0)
    coinSupplyObj.textContent = humanize.commaWithDecimal(extra.coin_value_supply, 2)
  }

  sortChainTable (e) {
    const column = e.currentTarget.dataset.column
    const newDirection = (this.currentSort.column === column && this.currentSort.direction === 'asc') ? 'desc' : 'asc'
    this.currentSort = { column: column, direction: newDirection }
    this.updateIcons()
    this.sortTable()
  }

  updateIcons () {
    this.sortIconTargets.forEach(icon => {
      const col = icon.dataset.column
      icon.classList.remove('sort-active')
      icon.innerHTML = '<path d="M2 3h6L5 0 2 3zm0 4h6L5 10 2 7z"/>' // default both arrows
      icon.classList.add('text-muted')

      if (col === this.currentSort.column) {
        icon.classList.remove('text-muted')
        icon.classList.add('sort-active')

        if (this.currentSort.direction === 'asc') {
          icon.innerHTML = '<path d="M2 6h6L5 3 2 6z"/>' // up arrow
        } else {
          icon.innerHTML = '<path d="M2 4h6L5 7 2 4z"/>' // down arrow
        }
      }
    })
  }

  sortTable () {
    const column = this.currentSort.column
    const direction = this.currentSort.direction
    const tbody = this.supportedTableTarget
    const rows = Array.from(tbody.querySelectorAll('tr'))
    const getCellValue = (row) => {
      const colIndex = {
        name: 0,
        block: 1,
        price: 2,
        cap: 3,
        vol: 4,
        txcount: 5,
        coinsupply: 6,
        size: 7
      }[column]

      const td = row.querySelectorAll('td')[colIndex]
      if (!td) return ''
      const value = td.dataset.value
      const val = parseFloat(value)
      return isNaN(val) ? value.toLowerCase() : val
    }

    rows.sort((a, b) => {
      const valA = getCellValue(a)
      const valB = getCellValue(b)
      return (valA > valB ? 1 : -1) * (direction === 'asc' ? 1 : -1)
    })

    rows.forEach(row => tbody.appendChild(row))
  }
}
