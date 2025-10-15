import { Controller } from '@hotwired/stimulus'
import globalEventBus from '../services/event_bus_service'
import humanize from '../helpers/humanize_helper'

export default class extends Controller {
  static get targets () {
    return ['lastBlockHeight', 'totalTransactions', 'sinceLastBlock', 'allSize',
      'feeTotal', 'outputCount', 'minFeeRatevB', 'maxFeeRatevB', 'txListBody']
  }

  connect () {
    this.processBlock = this._processBlock.bind(this)
    this.processXmrMempool = this._processXmrMempool.bind(this)
    globalEventBus.on('XMR_BLOCK_RECEIVED', this.processBlock)
    globalEventBus.on('MEMPOOL_XMR_RECEIVED', this.processXmrMempool)
  }

  disconnect () {
    globalEventBus.off('XMR_BLOCK_RECEIVED', this.processBlock)
    globalEventBus.off('MEMPOOL_XMR_RECEIVED', this.processXmrMempool)
  }

  _processBlock (blockData) {
    const block = blockData.block
    if (!block) {
      return
    }
    this.lastBlockHeightTarget.textContent = block.height
    this.sinceLastBlockTarget.dataset.age = block.blocktime_unix
    this.sinceLastBlockTarget.textContent = humanize.timeSince(block.blocktime_unix)
  }

  _processXmrMempool (mempoolData) {
    const mempool = mempoolData.xmr_mempool
    if (!mempool || Number(mempool) <= 0 || Number(mempool.inputs_count) <= 0 || Number(mempool.outputs_count) <= 0) {
      return
    }
    this.totalTransactionsTarget.textContent = humanize.commaWithDecimal(mempool.tx_count, 0)
    this.allSizeTarget.innerHTML = humanize.bytes(mempool.bytes_total)
    this.feeTotalTarget.innerHTML = humanize.decimalParts(Number(mempool.total_fee) / 1e12, false, 8, 2)
    this.outputCountTarget.textContent = humanize.commaWithDecimal(mempool.outputs_count, 0)
    this.minFeeRatevBTarget.textContent = humanize.commaWithDecimal(mempool.min_fee_rate, 0)
    this.maxFeeRatevBTarget.textContent = humanize.commaWithDecimal(mempool.max_fee_rate, 0)
    let memBodyHtml = ''
    console.log('check txlenght: ', mempool.transactions.length)
    if (!mempool.transactions || mempool.transactions.length <= 0) {
      memBodyHtml = ` <tr class="no-tx-tr">
                              <td colspan="5">No regular transactions in mempool.</td>
                           </tr>`
    } else {
      mempool.transactions.forEach((memtx) => {
        console.log('check txid: ', memtx.id_hash)
        memBodyHtml += `<tr>
                              <td class="break-word clipboard">
                                 <a class="hash lh1rem" href="/xmr/tx/${memtx.id_hash}">${memtx.id_hash}</a>
                                  <span class="dcricon-copy clickable"
                                    data-controller="clipboard"
                                    data-action="click->clipboard#copyTextToClipboard"
                                  ></span>
                                  <span class="alert alert-secondary alert-copy">
                                  </span>
                              </td>
                              <td class="mono fs15 text-end">
                                 ${humanize.decimalParts(Number(mempool.fee) / 1e12, false, 8, 2)}
                              </td>
                              <td class="mono fs15 text-end">${mempool.formattedSize}</td>
                           </tr>`
      })
    }
    this.txListBodyTarget.innerHTML = memBodyHtml
  }
}
