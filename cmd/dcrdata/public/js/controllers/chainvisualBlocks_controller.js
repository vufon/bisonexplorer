import { Controller } from '@hotwired/stimulus'
import globalEventBus from '../services/event_bus_service'
import mempoolJS from '../vendor/mempool'
import humanize from '../helpers/humanize_helper'

function getAtomsRate (chainType) {
  if (chainType === 'xmr') {
    return 1e12
  }
  return 1e8
}

export default class extends Controller {
  static get targets () {
    return ['box', 'title', 'showmore', 'root', 'txs', 'tooltip', 'block',
      'memTotalSent', 'memTime']
  }

  connect () {
    this.chainType = this.data.get('chainType')
    this.processBlock = this._processBlock.bind(this)
    switch (this.chainType) {
      case 'ltc':
        globalEventBus.on('LTC_BLOCK_RECEIVED', this.processBlock)
        break
      case 'btc':
        globalEventBus.on('BTC_BLOCK_RECEIVED', this.processBlock)
        break
      case 'xmr':
        globalEventBus.on('XMR_BLOCK_RECEIVED', this.processBlock)
        break
    }
    this.setupTooltips()
    if (this.chainType !== 'xmr') {
      this.wsHostName = this.chainType === 'ltc' ? 'litecoinspace.org' : 'mempool.space'
      const { bitcoin: { websocket } } = mempoolJS({
        hostname: this.wsHostName
      })
      this.ws = websocket.initClient({
        options: ['blocks', 'stats', 'mempool-blocks', 'live-2h-chart']
      })
      this.mempoolSocketInit()
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
    // close websocket for mempool
    if (this.chainType !== 'xmr') {
      this.ws.close()
    }
  }

  _processBlock (blockData) {
    const blocks = blockData.blocks
    const newBlock = blockData.block
    if (!blocks || !newBlock || blocks.length <= 0) {
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
        `<a class="color-code" href="/${_this.chainType}/block/${block.height}">${block.height}</a>` +
        '<div class="mono amount" style="line-height: 1;">' +
        `<span>${_this.chainType === 'xmr' ? '?' : humanize.threeSigFigs(block.TotalSentSats / 1e8)}</span>` +
        `<span class="unit">${_this.chainType.toUpperCase()}</span>` +
        `</div><span class="timespan"><span data-time-target="age" data-age="${block.blocktime_unix}"></span>&nbsp;ago</span></div>` +
        '<div class="block-rows chain-block-rows"><div class="block-rewards px-1 mt-1" style="flex-grow: 1">' +
        `<span class="pow chain-pow left-vs-block-data" style="flex-grow: ${block.BlockReward / getAtomsRate(_this.chainType)}" ` +
        `title='{"object": "Block Reward", "total": "${block.BlockReward / getAtomsRate(_this.chainType)}"}' ` +
        'data-chainvisualBlocks-target="tooltip"><span class="block-element-link"></span>' +
        `</span><span class="fees right-vs-block-data" style="flex-grow: ${block.FeesSats / getAtomsRate(_this.chainType)}" ` +
        `title='{"object": "Tx Fees", "total": "${block.FeesSats / getAtomsRate(_this.chainType)}"}' data-chainvisualBlocks-target="tooltip">` +
        '<span class="block-element-link"></span></span></div><div class="block-transactions px-1 my-1" style="flex-grow: 1">' +
        `<span class="chain-block-tx left-vs-block-data" style="flex-grow: ${block.tx_count}" data-chainvisualBlocks-target="tooltip" title='{"object": "Tx Count", "count": "${block.tx_count}"}'>` +
        '<span class="block-element-link"></span></span>' +
        `<span class="chain-block-tx" style="flex-grow: ${block.TotalInputs}" data-chainvisualBlocks-target="tooltip" title='{"object": "Inputs Count", "count": "${block.TotalInputs}"}'>` +
        '<span class="block-element-link"></span></span>' +
        `<span class="chain-block-tx right-vs-block-data" style="flex-grow: ${block.TotalOutputs}" data-chainvisualBlocks-target="tooltip" title='{"object": "Outputs Count", "count": "${block.TotalOutputs}"}'>` +
        '<span class="block-element-link"></span></span></div></div>'
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
    this.setupTooltips()
  }

  visibleBlocks () {
    return this.boxTarget.querySelectorAll('.visible')
  }

  mempoolSocketInit () {
    const _this = this
    const memBlockReward = document.getElementById('memBlockReward')
    const memFeeSpan = document.getElementById('memFeeSpan')
    const memTxCount = document.getElementById('memTxCount')
    const memInputCount = document.getElementById('memInputCount')
    const memOutputCount = document.getElementById('memOutputCount')
    // mempool local data
    this.txCount = Number(memTxCount.getAttribute('data-value'))
    this.fees = parseFloat(memFeeSpan.getAttribute('data-value'))
    this.totalSent = parseFloat(this.memTotalSentTarget.getAttribute('data-value'))
    this.inputsCount = Number(memInputCount.getAttribute('data-value'))
    this.outputsCount = Number(memOutputCount.getAttribute('data-value'))
    this.memRewardBlockOuter = memBlockReward.outerHTML
    this.ws.addEventListener('message', function incoming ({ data }) {
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
        if (mempoolBox) {
          mempoolBox.remove()
        }
        // Create best block target
        const mempoolInnerTarget = '<div class="block-info">' +
        `<a class="color-code" href="/${_this.chainType}/mempool">Mempool</a>` +
        '<div class="mono amount" style="line-height: 1;">' +
        `<span>${humanize.threeSigFigs(_this.totalSent)}</span>` +
        `<span class="unit">${_this.chainType.toUpperCase()}</span>` +
        '</div><span class="timespan">now</span></div>' +
        '<div class="block-rows chain-block-rows"><div class="block-rewards px-1 mt-1" style="flex-grow: 1">' +
        _this.memRewardBlockOuter +
        `<span class="fees right-vs-block-data" style="flex-grow: ${_this.fees / 1e8}" ` +
        `title='{"object": "Tx Fees", "total": "${_this.fees}"}' data-chainvisualBlocks-target="tooltip">` +
        '<span class="block-element-link"></span></span></div><div class="block-transactions px-1 my-1" style="flex-grow: 1">' +
        `<span class="chain-block-tx left-vs-block-data" data-chainvisualBlocks-target="tooltip" style="flex-grow: ${_this.txCount}" title='{"object": "Tx Count", "count": "${_this.txCount}"}'>` +
        '<span class="block-element-link"></span></span>' +
        `<span class="chain-block-tx" data-chainvisualBlocks-target="tooltip" style="flex-grow: ${_this.inputsCount}" title='{"object": "Inputs Count", "count": "${_this.inputsCount}"}'>` +
        '<span class="block-element-link"></span></span>' +
        `<span class="chain-block-tx right-vs-block-data" data-chainvisualBlocks-target="tooltip" style="flex-grow: ${_this.outputsCount}" title='{"object": "Outputs Count", "count": "${_this.outputsCount}"}'>` +
        '<span class="block-element-link"></span></span></div></div>'
        // remove old mempool box
        const theKid = document.createElement('div')
        theKid.setAttribute('data-chainvisualBlocks-target', 'block')
        theKid.id = 'memblocks'
        theKid.classList.add('block')
        theKid.classList.add('visible')
        theKid.innerHTML = mempoolInnerTarget
        _this.boxTarget.prepend(theKid)
        _this.setupTooltips()
      }
    })
  }

  setupTooltips () {
    const _this = this
    this.tooltipTargets.forEach((tooltipElement) => {
      try {
        // parse the content
        const data = JSON.parse(tooltipElement.title)
        let newContent
        if (data.count) {
          newContent = `<b>${data.object}</b><br>${data.count}`
        } else {
          newContent = `<b>${data.object}</b><br>${data.total} ` + _this.chainType.toUpperCase()
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
}
