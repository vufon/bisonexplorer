import { Controller } from '@hotwired/stimulus'
import humanize from '../helpers/humanize_helper'
import globalEventBus from '../services/event_bus_service'

export default class extends Controller {
  static get targets () {
    return ['difficulty', 'blockHeight', 'blockTime', 'supportedTable']
  }

  connect () {
    const activeChainStr = this.data.get('activeChain')
    if (!activeChainStr || activeChainStr === '') {
      return
    }
    this.activeChainArr = activeChainStr.split(',')
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
    blockHeightObj.href = (chainType === 'dcr' ? '' : '/chain/' + chainType) + `/block/${block.hash}`

    // handler extra data
    const extra = blockData.extra
    if (!extra) {
      return
    }
    txCountObj.textContent = humanize.commaWithDecimal(extra.total_transactions, 0)
    coinSupplyObj.textContent = humanize.commaWithDecimal(extra.coin_value_supply, 2)
  }
}
