import { Controller } from '@hotwired/stimulus'
import humanize from '../helpers/humanize_helper'
import globalEventBus from '../services/event_bus_service'
import mempoolJS from '../vendor/mempool'

export default class extends Controller {
  static get targets () {
    return ['blockHeight', 'blockTotal', 'blockSize', 'blockTime',
      'exchangeRate', 'totalTransactions', 'coinSupply', 'convertedSupply',
      'powBar', 'rewardIdx', 'txCount', 'txOutCount', 'totalSent', 'totalFee',
      'minFeeRate', 'maxFeeRate', 'totalSize', 'remainingBlocks', 'timeRemaning',
      'diffChange', 'prevRetarget', 'blockTimeAvg']
  }

  async connect () {
    this.chainType = this.data.get('chainType')
    this.wsHostName = this.chainType === 'ltc' ? 'litecoinspace.org' : 'mempool.space'
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
    const { bitcoin: { websocket } } = mempoolJS({
      hostname: this.wsHostName
    })
    this.ws = websocket.initClient({
      options: ['blocks', 'stats', 'mempool-blocks', 'live-2h-chart']
    })
    this.mempoolSocketInit()
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
    this.ws.close()
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

  async mempoolSocketInit () {
    const _this = this
    this.ws.addEventListener('message', function incoming ({ data }) {
      const res = JSON.parse(data.toString())
      if (res.mempoolInfo) {
        _this.txCountTarget.innerHTML = humanize.decimalParts(res.mempoolInfo.size, true, 0)
        if (_this.chainType === 'btc') {
          _this.totalFeeTarget.innerHTML = humanize.decimalParts(res.mempoolInfo.total_fee, false, 8, 2)
        }
      }
      if (res['mempool-blocks']) {
        let totalSize = 0
        let ltcTotalFee = 0
        let minFeeRatevB = Number.MAX_VALUE
        let maxFeeRatevB = 0
        res['mempool-blocks'].forEach(memBlock => {
          totalSize += memBlock.blockSize
          if (_this.chainType === 'ltc') {
            ltcTotalFee += memBlock.totalFees
          }
          if (memBlock.feeRange) {
            memBlock.feeRange.forEach(feevB => {
              if (minFeeRatevB > feevB) {
                minFeeRatevB = feevB
              }
              if (maxFeeRatevB < feevB) {
                maxFeeRatevB = feevB
              }
            })
          }
        })
        if (_this.chainType === 'ltc') {
          _this.totalFeeTarget.innerHTML = humanize.decimalParts(ltcTotalFee / 1e8, false, 8, 2)
        }
        _this.minFeeRateTarget.innerHTML = humanize.decimalParts(minFeeRatevB, true, 0)
        _this.maxFeeRateTarget.innerHTML = humanize.decimalParts(maxFeeRatevB, true, 0)
        _this.totalSizeTarget.innerHTML = humanize.bytes(totalSize)
      }
      if (res.block) {
        const extras = res.block.extras
        _this.txOutCountTarget.innerHTML = humanize.decimalParts(extras.totalOutputs, true, 0)
        _this.totalSentTarget.innerHTML = humanize.decimalParts(extras.totalOutputAmt / 1e8, false, 8, 2)
      }
      if (res.blocks) {
        let txOutCount = 0
        let totalSent = 0
        res.blocks.forEach(block => {
          const extras = block.extras
          txOutCount += extras.totalOutputs
          totalSent += extras.totalOutputAmt
        })
        _this.txOutCountTarget.innerHTML = humanize.decimalParts(txOutCount, true, 0)
        _this.totalSentTarget.innerHTML = humanize.decimalParts(totalSent / 1e8, false, 3, 2)
      }
      if (res.da) {
        const diffChange = res.da.difficultyChange
        const prevRetarget = res.da.previousRetarget
        const remainingBlocks = res.da.remainingBlocks
        const timeRemaining = res.da.remainingTime
        const timeAvg = res.da.timeAvg
        _this.diffChangeTarget.innerHTML = humanize.decimalParts(diffChange, false, 2, 0)
        if (diffChange > 0) {
          _this.diffChangeTarget.classList.remove('c-red')
          _this.diffChangeTarget.classList.add('c-green-2')
        } else {
          _this.diffChangeTarget.classList.add('c-red')
          _this.diffChangeTarget.classList.remove('c-green-2')
        }
        _this.prevRetargetTarget.innerHTML = humanize.threeSigFigs(prevRetarget)
        _this.remainingBlocksTarget.innerHTML = humanize.decimalParts(remainingBlocks, true, 0)
        _this.timeRemaningTarget.setAttribute('data-duration', timeRemaining)
        _this.blockTimeAvgTarget.setAttribute('data-duration', timeAvg)
      }
    })
  }
}
