import { Controller } from '@hotwired/stimulus'
import globalEventBus from '../services/event_bus_service'
import mempoolJS from '../vendor/mempool'
import humanize from '../helpers/humanize_helper'

export default class extends Controller {
  static get targets () {
    return ['box', 'title', 'showmore', 'root', 'txs', 'tooltip', 'block',
      'memTotalSent', 'memTime', 'memFeeSpan', 'memTxCount', 'memInputCount',
      'memOutputCount', 'memBlockReward'
    ]
  }

  connect () {
    this.chainType = this.data.get('chainType')
    this.wsHostName = this.chainType === 'ltc' ? 'litecoinspace.org' : 'mempool.space'
    this.mempoolSocketInit()
    this.processBlock = this._processBlock.bind(this)
    switch (this.chainType) {
      case 'ltc':
        globalEventBus.on('LTC_BLOCK_RECEIVED', this.processBlock)
        break
      case 'btc':
        globalEventBus.on('BTC_BLOCK_RECEIVED', this.processBlock)
    }
  }

  disconnect () {
    switch (this.chainType) {
      case 'ltc':
        globalEventBus.off('LTC_BLOCK_RECEIVED', this.processBlock)
        break
      case 'btc':
        globalEventBus.off('BTC_BLOCK_RECEIVED', this.processBlock)
    }
  }

  _processBlock (blockData) {
    const blocks = blockData.blocks
    const newBlock = blockData.block
    if (!blocks || !newBlock) {
      return
    }
    // get last block (oldest block) target
    this.blockTargets.forEach(blockTarget => {
      if (blockTarget.id !== 'memblocks') {
        let exist = false
        // remove block exclude in blocks
        blocks.forEach(block => {
          if (Number(block.height) === Number(blockTarget.id)) {
            exist = true
          }
        })
        if (!exist) {
          // if not exist, remove
          blockTarget.remove()
        }
      }
    })

    // sort blocks
    blocks.sort((a, b) => {
      if (a.height > b.height) {
        return 1
      }
      if (a.height < b.height) {
        return -1
      }
      return 0
    })

    let firstBlockHeight = 0
    // get first block target height on DOM
    this.blockTargets.forEach(blockTarget => {
      if (blockTarget.id !== 'memblocks') {
        if (Number(blockTarget.id) > firstBlockHeight) {
          firstBlockHeight = Number(blockTarget.id)
        }
      }
    })
    const _this = this
    // mempool outerHTML
    const mempoolBlock = document.getElementById('memblocks')
    if (!mempoolBlock) {
      return
    }
    const meminnerHtml = mempoolBlock.innerHTML
    if (!meminnerHtml) {
      return
    }
    mempoolBlock.remove()
    blocks.forEach(block => {
      if (block.height > firstBlockHeight) {
        // Create best block target
        const bestBlockTarget = '<div class="block-info">' +
          `<a class="color-code" href="/chain/${_this.chainType}/block/${block.height}">${block.height}</a>` +
          '<div class="mono amount" style="line-height: 1;">' +
          `<span>${humanize.threeSigFigs(block.TotalSentSats / 1e8)}</span>` +
          `<span class="unit">${_this.chainType.toUpperCase()}</span>` +
          `</div><span class="timespan"><span data-time-target="age" data-age="${block.blocktime_unix}"></span>&nbsp;ago</span></div>` +
          '<div class="block-rows"><div class="block-rewards" style="flex-grow: 1">' +
          `<span class="pow" style="flex-grow: ${block.BlockReward / 1e8}"` +
          `title='{"object": "Block Reward", "value": "${block.BlockReward / 1e8} ${_this.chainType.toUpperCase()}"}'` +
          'data-chainvisualBlocks-target="tooltip"><a class="block-element-link" href="#"></a>' +
          `</span><span class="fees" style="flex-grow: ${block.FeesSats / 1e8}" ` +
          `title='{"object": "Tx Fees", "value": "${block.FeesSats / 1e8} ${_this.chainType.toUpperCase()}"}' data-chainvisualBlocks-target="tooltip">` +
          '<a class="block-element-link" href="#"></a></span></div><div class="block-transactions" style="flex-grow: 1">' +
          `<span class="block-tx" style="flex-grow: ${block.tx_count}" title='{"object": "Tx Count", "count": "${block.tx_count}"}'>` +
          '<a class="block-element-link" href="#"></a></span>' +
          `<span class="block-tx" style="flex-grow: ${block.TotalInputs}" title='{"object": "Inputs Count", "count": "${block.TotalInputs}"}'>` +
          '<a class="block-element-link" href="#"></a></span>' +
          `<span class="block-tx" style="flex-grow: ${block.TotalOutputs}" title='{"object": "Outputs Count", "count": "${block.TotalOutputs}"}'>` +
          '<a class="block-element-link" href="#"></a></span></div></div>'
        // create first block
        const theFirst = document.createElement('div')
        theFirst.setAttribute('data-chainvisualBlocks-target', 'block')
        theFirst.id = block.height + ''
        theFirst.classList.add('block')
        theFirst.classList.add('visible')
        theFirst.innerHTML = bestBlockTarget
        _this.boxTarget.prepend(theFirst)
      }
    })
    // create mempool box
    const mempoolBox = document.createElement('div')
    mempoolBox.setAttribute('data-chainvisualBlocks-target', 'block')
    mempoolBox.id = 'memblocks'
    mempoolBox.classList.add('block')
    mempoolBox.classList.add('visible')
    mempoolBox.innerHTML = meminnerHtml
    this.boxTarget.prepend(mempoolBox)
  }

  visibleBlocks () {
    return this.boxTarget.querySelectorAll('.visible')
  }

  async mempoolSocketInit () {
    const { bitcoin: { websocket } } = mempoolJS({
      hostname: this.wsHostName
    })
    const ws = websocket.initClient({
      options: ['blocks', 'stats', 'mempool-blocks', 'live-2h-chart']
    })
    const _this = this
    // mempool local data
    this.txCount = Number(this.memTxCountTarget.getAttribute('data-value'))
    this.fees = parseFloat(this.memFeeSpanTarget.getAttribute('data-value'))
    this.totalSent = parseFloat(this.memTotalSentTarget.getAttribute('data-value'))
    this.inputsCount = Number(this.memInputCountTarget.getAttribute('data-value'))
    this.outputsCount = Number(this.memOutputCountTarget.getAttribute('data-value'))
    ws.addEventListener('message', function incoming ({ data }) {
      let hasChange = false
      const res = JSON.parse(data.toString())
      if (res.mempoolInfo) {
        hasChange = true
        _this.txCount = res.mempoolInfo.size
        if (_this.chainType === 'btc') {
          _this.fees = res.mempoolInfo.total_fee
        }
      }
      if (res['mempool-blocks']) {
        hasChange = true
        let ltcTotalFee = 0
        res['mempool-blocks'].forEach(memBlock => {
          if (_this.chainType === 'ltc') {
            ltcTotalFee += memBlock.totalFees
          }
        })
        if (_this.chainType === 'ltc') {
          _this.fees = ltcTotalFee / 1e8
        }
      }
      if (res.block) {
        hasChange = true
        const extras = res.block.extras
        _this.inputsCount = extras.totalInputs
        _this.outputsCount = extras.totalOutputs
        _this.totalSent = extras.totalOutputAmt / 1e8
      }
      if (res.blocks) {
        hasChange = true
        let txOutCount = 0
        let txInCount = 0
        let tempTotalSent = 0
        res.blocks.forEach(block => {
          const extras = block.extras
          txOutCount += extras.totalOutputs
          txInCount += extras.totalInputs
          tempTotalSent += extras.totalOutputAmt
        })
        _this.totalSent = tempTotalSent / 1e8
        _this.inputsCount = txInCount
        _this.outputsCount = txOutCount
      }
      if (hasChange) {
        const mempoolBox = document.getElementById('memblocks')
        if (!mempoolBox) {
          return
        }
        // Create best block target
        const mempoolInnerTarget = '<div class="block-info">' +
          `<a class="color-code" href="/chain/${_this.chainType}/mempool">Mempool</a>` +
          '<div class="mono amount" style="line-height: 1;">' +
          `<span>${humanize.threeSigFigs(_this.totalSent)}</span>` +
          `<span class="unit">${_this.chainType.toUpperCase()}</span>` +
          '</div><span class="timespan">now</span></div>' +
          '<div class="block-rows"><div class="block-rewards" style="flex-grow: 1">' +
          _this.memBlockRewardTarget.outerHTML +
          `<span class="fees" style="flex-grow: ${_this.fees / 1e8}" ` +
          `title='{"object": "Tx Fees", "value": "${_this.fees} ${_this.chainType.toUpperCase()}"}' data-chainvisualBlocks-target="tooltip">` +
          '<a class="block-element-link" href="#"></a></span></div><div class="block-transactions" style="flex-grow: 1">' +
          `<span class="block-tx" style="flex-grow: ${_this.txCount}" title='{"object": "Tx Count", "count": "${_this.txCount}"}'>` +
          '<a class="block-element-link" href="#"></a></span>' +
          `<span class="block-tx" style="flex-grow: ${_this.inputsCount}" title='{"object": "Inputs Count", "count": "${_this.inputsCount}"}'>` +
          '<a class="block-element-link" href="#"></a></span>' +
          `<span class="block-tx" style="flex-grow: ${_this.outputsCount}" title='{"object": "Outputs Count", "count": "${_this.outputsCount}"}'>` +
          '<a class="block-element-link" href="#"></a></span></div></div>'
        // remove old mempool box
        mempoolBox.remove()
        const theKid = document.createElement('div')
        theKid.setAttribute('data-chainvisualBlocks-target', 'block')
        theKid.id = 'memblocks'
        theKid.classList.add('block')
        theKid.classList.add('visible')
        theKid.innerHTML = mempoolInnerTarget
        _this.boxTarget.prepend(theKid)
      }
    })
  }
}
