import { Controller } from '@hotwired/stimulus'
import mempoolJS from '../vendor/mempool'
import humanize from '../helpers/humanize_helper'

export default class extends Controller {
  static get targets () {
    return ['txCount', 'totalFees', 'txOutCount', 'minFeeRate', 'maxFeeRate', 'transList', 'totalSent', 'bestBlock', 'bestBlockTime', 'lastBlockSize']
  }

  initialize () {
    this.chainType = this.data.get('chainType')
    this.wsHostName = this.chainType === 'ltc' ? 'litecoinspace.org' : 'mempool.space'
    this.mempoolSocketInit()
  }

  async mempoolSocketInit () {
    const { bitcoin: { websocket } } = mempoolJS({
      hostname: this.wsHostName
    })
    const ws = websocket.initClient({
      options: ['blocks', 'stats', 'mempool-blocks', 'live-2h-chart']
    })
    const _this = this
    ws.addEventListener('message', function incoming ({ data }) {
      const res = JSON.parse(data.toString())
      if (res.mempoolInfo) {
        _this.txCountTarget.innerHTML = humanize.decimalParts(res.mempoolInfo.size, true, 0)
        if (_this.chainType === 'btc') {
          _this.totalFeesTarget.innerHTML = humanize.decimalParts(res.mempoolInfo.total_fee, false, 8, 2)
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
          _this.totalFeesTarget.innerHTML = humanize.decimalParts(ltcTotalFee / 1e8, false, 8, 2)
        }
        _this.minFeeRateTarget.innerHTML = humanize.decimalParts(minFeeRatevB, true, 0)
        _this.maxFeeRateTarget.innerHTML = humanize.decimalParts(maxFeeRatevB, true, 0)
        _this.lastBlockSizeTarget.innerHTML = humanize.bytes(totalSize)
      }
      if (res.block) {
        const blockHeight = res.block.height
        _this.bestBlockTarget.textContent = blockHeight
        _this.bestBlockTimeTarget.setAttribute('data-age', res.block.timestamp)
        const extras = res.block.extras
        _this.txOutCountTarget.innerHTML = humanize.decimalParts(extras.totalOutputs, true, 0)
        _this.totalSentTarget.innerHTML = humanize.threeSigFigs(extras.totalOutputAmt / 1e8)
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
        _this.totalSentTarget.innerHTML = humanize.threeSigFigs(totalSent / 1e8)
      }
      if (res.transactions) {
        let inner = ''
        res.transactions.forEach(tx => {
          const txHash = tx.txid
          const totalOut = tx.value
          const fees = tx.fee
          const rate = tx.rate
          inner += `<tr><td class="break-word clipboard"><a class="hash lh1rem" href="/chain/${_this.chainType}/tx/${txHash}">${txHash}</a><span class="dcricon-copy clickable" data-controller="clipboard"` +
                  'data-action="click->clipboard#copyTextToClipboard"></span><span class="alert alert-secondary alert-copy"></span></td>'
          inner += `<td class="mono fs15 text-end">${humanize.decimalParts(totalOut / 1e8, false, 8, 2)}</td>`
          inner += `<td class="mono fs15 text-end">${humanize.decimalParts(fees / 1e8, false, 8, 2)}</td>`
          inner += `<td class="mono fs15 text-end">${humanize.decimalParts(rate, false, 8, 2)}</td></tr>`
        })
        _this.transListTarget.innerHTML = inner
      }
    })
  }
}
