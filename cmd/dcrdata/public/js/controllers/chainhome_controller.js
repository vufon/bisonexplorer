import { Controller } from '@hotwired/stimulus'
import humanize from '../helpers/humanize_helper'
import globalEventBus from '../services/event_bus_service'

export default class extends Controller {
  static get targets () {
    return ['blockHeight', 'blockTotal', 'blockSize', 'blockTime',
      'exchangeRate', 'totalTransactions', 'coinSupply', 'convertedSupply',
      'powBar', 'rewardIdx']
  }

  async connect () {
    this.chainType = this.data.get('chainType')
    const rateStr = this.data.get('exchangeRate')
    this.exchangeRate = 0.0
    if (rateStr && rateStr !== '') {
      this.exchangeRate = parseFloat(rateStr)
    }
    this.processBlock = this._processBlock.bind(this)
    switch (this.chainType) {
      case 'ltc':
        globalEventBus.on('LTC_BLOCK_RECEIVED', this.processBlock)
        break
      case 'btc':
        globalEventBus.on('BTC_BLOCK_RECEIVED', this.processBlock)
    }
    this.processXcUpdate = this._processXcUpdate.bind(this)
    globalEventBus.on('EXCHANGE_UPDATE', this.processXcUpdate)
  }

  _processXcUpdate (update) {
    const xc = update.updater
    const cType = xc.chain_type
    if (cType !== this.chainType) {
      return
    }
    this.exchangeRate = xc.price
    this.exchangeRateTarget.textContent = humanize.twoDecimals(xc.price)
  }

  disconnect () {
    switch (this.chainType) {
      case 'ltc':
        globalEventBus.off('LTC_BLOCK_RECEIVED', this.processBlock)
        break
      case 'btc':
        globalEventBus.off('BTC_BLOCK_RECEIVED', this.processBlock)
    }
    globalEventBus.off('EXCHANGE_UPDATE', this.processXcUpdate)
  }

  _processBlock (blockData) {
    const block = blockData.block
    this.blockHeightTarget.textContent = block.height
    this.blockHeightTarget.href = `/block/${block.hash}`
    this.blockSizeTarget.textContent = humanize.bytes(block.size)
    this.blockTotalTarget.textContent = humanize.threeSigFigs(block.total)
    this.blockTimeTarget.dataset.age = block.blocktime_unix
    this.blockTimeTarget.textContent = humanize.timeSince(block.blocktime_unix)
    // handler extra data
    const extra = blockData.extra
    if (!extra) {
      return
    }
    this.totalTransactionsTarget.textContent = humanize.commaWithDecimal(extra.total_transactions, 0)
    this.coinSupplyTarget.textContent = humanize.commaWithDecimal(extra.coin_value_supply, 2)
    if (this.exchangeRate > 0) {
      const exchangeValue = extra.coin_value_supply * this.exchangeRate
      this.convertedSupplyTarget.textContent = humanize.threeSigFigs(exchangeValue) + 'USD'
    }
  }
}
