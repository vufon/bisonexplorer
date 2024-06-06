import { Controller } from '@hotwired/stimulus'
import TurboQuery from '../helpers/turbolinks_helper'
import { requestJSON } from '../helpers/http'

const responseCache = {}
let requestCounter = 0

function hasCache (k) {
  if (!responseCache[k]) return false
  const expiration = new Date(responseCache[k].expiration)
  return expiration > new Date()
}

export default class extends Controller {
  static get targets () {
    return [
      'blockHeight',
      'startDate', 'endDate',
      'priceDCR', 'dayText', 'amount', 'days', 'daysText',
      'amountRoi', 'percentageRoi',
      'table', 'tableBody', 'rowTemplate', 'amountError', 'startDateErr'
    ]
  }

  async initialize () {
    this.rewardPeriod = parseInt(this.data.get('rewardPeriod'))
    this.targetTimePerBlock = parseInt(this.data.get('timePerblock'))
    this.ticketExpiry = parseInt(this.data.get('ticketExpiry'))
    this.ticketMaturity = parseInt(this.data.get('ticketMaturity'))
    this.coinbaseMaturity = parseInt(this.data.get('coinbaseMaturity'))
    this.ticketsPerBlock = parseInt(this.data.get('ticketsPerblock'))
    this.ticketPrice = parseFloat(this.data.get('ticketPrice'))
    this.poolSize = parseInt(this.data.get('poolSize'))
    this.poolValue = parseFloat(this.data.get('poolValue'))
    this.blockHeight = parseInt(this.data.get('blockHeight'))
    this.coinSupply = parseInt(this.data.get('coinSupply')) / 1e8
    // default, startDate is 3 month ago
    this.last3Months = new Date()
    this.last3Months.setMonth(this.last3Months.getMonth() - 3)
    this.startDateTarget.value = this.formatDateToString(this.last3Months)
    this.endDateTarget.value = this.formatDateToString(new Date())
    this.amountTarget.value = 1000

    this.query = new TurboQuery()
    this.settings = TurboQuery.nullTemplate([
      'amount', 'start', 'end'
    ])

    this.defaultSettings = {
      amount: 1000,
      start: this.startDateTarget.value,
      end: this.endDateTarget.value
    }

    this.query.update(this.settings)
    if (this.settings.amount) {
      this.amountTarget.value = this.settings.amount
    }
    if (this.settings.start) {
      this.startDateTarget.value = this.settings.start
    }
    if (this.settings.end) {
      this.endDateTarget.value = this.settings.end
    }

    this.calculate()
  }

  // Amount input event
  amountKeypress (e) {
    if (e.keyCode === 13) {
      this.amountChanged()
    }
  }

  // convert date to strin display (YYYY-MM-DD)
  formatDateToString (date) {
    return [
      date.getFullYear(),
      ('0' + (date.getMonth() + 1)).slice(-2),
      ('0' + date.getDate()).slice(-2)
    ].join('-')
  }

  updateQueryString () {
    const [query, settings, defaults] = [{}, this.settings, this.defaultSettings]
    for (const k in settings) {
      if (!settings[k] || settings[k].toString() === defaults[k].toString()) continue
      query[k] = settings[k]
    }
    this.query.replace(query)
  }

  // When amount was changed
  amountChanged () {
    this.settings.amount = parseInt(this.amountTarget.value)
    this.calculate()
  }

  // StartDate type event
  startDateKeypress (e) {
    if (e.keyCode !== 13) {
      return
    }
    if (!this.validateDate()) {
      return
    }
    this.startDateChanged()
  }

  // When startDate was changed
  startDateChanged () {
    if (!this.validateDate()) {
      return
    }
    this.settings.start = this.startDateTarget.value
    this.calculate()
  }

  // EndDate type event
  endDateKeypress (e) {
    if (e.keyCode !== 13) {
      return
    }
    if (!this.validateDate()) {
      return
    }
    this.endDateChanged()
  }

  // When EndDate was changed
  endDateChanged () {
    if (!this.validateDate()) {
      return
    }
    this.settings.end = this.endDateTarget.value
    this.calculate()
  }

  // Validate Date range
  validateDate () {
    const startDate = new Date(this.startDateTarget.value)
    const endDate = new Date(this.endDateTarget.value)

    if (startDate > endDate) {
      this.startDateErrTarget.textContent = 'Invalid date range'
      return
    }
    const days = this.getDaysOfRange(startDate, endDate)
    if (days < this.rewardPeriod) {
      this.startDateErrTarget.textContent = `You must stake for more than ${this.rewardPeriod} days`
      return false
    }

    this.startDateErrTarget.textContent = ''
    return true
  }

  hideAll (targets) {
    targets.classList.add('d-none')
  }

  showAll (targets) {
    targets.classList.remove('d-none')
  }

  // Get days between startDate and endDate
  getDaysOfRange (startDate, endDate) {
    const differenceInTime = endDate.getTime() - startDate.getTime()
    return differenceInTime / (1000 * 3600 * 24)
  }

  // Get Date from Days start from startDay
  getDateFromDays (startDate, days) {
    const tmpDate = new Date()
    tmpDate.setFullYear(startDate.getFullYear())
    tmpDate.setMonth(startDate.getMonth())
    tmpDate.setDate(startDate.getDate() + Number(days))
    return this.formatDateToString(tmpDate)
  }

  handlerRewardCalculator (days, startDate, amount) {
    let today = new Date()
    today = new Date(today.setUTCHours(0, 0, 0, 0))
    let startingHeight = this.blockHeight
    if (startDate.getTime() !== today.getTime()) {
      const miliSecDiff = Math.abs(startDate - today)
      const minutes = Math.floor(miliSecDiff / (1000 * 60))
      const targetTimePerBlockMinutes = Math.floor(this.targetTimePerBlock / 60)
      const blockDiff = Math.floor(minutes / targetTimePerBlockMinutes)
      if (startDate.getTime() < today.getTime()) {
        startingHeight = startingHeight - blockDiff
      } else {
        startingHeight = startingHeight + blockDiff
      }
    }
    const stakePerc = this.poolValue / this.coinSupply
    this.simulateStakingReward(days, amount, stakePerc, this.coinSupply, startingHeight, this.ticketPrice, this.blockHeight, startDate, amount)
  }

  async simulateStakingReward (numOfDays, startingBalance, currentStakePercent,
    actualCoinBase, startingBlockHeight, actualTicketPrice, blockHeight, startDate, amount) {
    requestCounter++
    const thisRequest = requestCounter
    const blocksPerDay = 86400 / this.targetTimePerBlock
    const numberOfBlocks = numOfDays * blocksPerDay
    let ticketsPurchased = 0
    const coinAdjustmentFactor = actualCoinBase / this.maxCoinSupplyAtBlock(startingBlockHeight)
    const meanVotingBlock = this.calcMeanVotingBlocks()
    const theoTicketPrice = this.theoreticalTicketPrice(startingBlockHeight, coinAdjustmentFactor, currentStakePercent, meanVotingBlock)
    const ticketAdjustmentFactor = actualTicketPrice / this.theoreticalTicketPrice(blockHeight, coinAdjustmentFactor, currentStakePercent, meanVotingBlock)
    // Prepare for simulation
    let simblock = startingBlockHeight
    let ticketPrice = 0
    let dcrBalance = startingBalance
    const simulationTable = []
    simulationTable.push({
      simBlock: simblock,
      simDay: 0,
      dcrBalance: dcrBalance,
      ticketPrice: theoTicketPrice,
      reward: 0
    })

    // Get milstone to get subsidy info
    const simBlockMilestone = []
    let tmpSimblock = simblock
    while (tmpSimblock < numberOfBlocks + startingBlockHeight) {
      tmpSimblock += this.ticketMaturity + meanVotingBlock
      tmpSimblock = Math.floor(tmpSimblock)
      simBlockMilestone.push(tmpSimblock)
      tmpSimblock += this.coinbaseMaturity
      tmpSimblock++
    }
    const blockListParam = simBlockMilestone.join(',')
    // get subsidy for milestones
    const url = `/api/stakingcalc/getBlocksReward?list=${blockListParam}`
    let response
    if (hasCache(url)) {
      response = responseCache[url]
    } else {
      // response = await axios.get(url)
      response = await requestJSON(url)
      responseCache[url] = response
      if (thisRequest !== requestCounter) {
        // new request was issued while waiting.
        this.startDateTarget.classList.remove('loading')
        return
      }
    }
    const rewardMap = response.rewardMap
    const rewardMyMap = new Map()
    for (const key in rewardMap) {
      rewardMyMap.set(Number(key), rewardMap[key])
    }
    while (simblock < numberOfBlocks + startingBlockHeight) {
      ticketPrice = this.theoreticalTicketPrice(simblock, coinAdjustmentFactor, currentStakePercent, meanVotingBlock) * ticketAdjustmentFactor
      ticketsPurchased = Math.floor(dcrBalance / ticketPrice)
      simulationTable[simulationTable.length - 1].ticketPrice = ticketPrice
      simulationTable[simulationTable.length - 1].ticketsPurchased = ticketsPurchased
      simblock += this.ticketMaturity + meanVotingBlock
      simblock = Math.floor(simblock)
      if (!rewardMyMap.has(simblock)) {
        continue
      }
      dcrBalance += rewardMyMap.get(simblock) * ticketsPurchased
      const blocksPassed = simblock - simulationTable[simulationTable.length - 1].simBlock
      const daysPassed = blocksPassed / blocksPerDay
      const day = simulationTable[simulationTable.length - 1].simDay + Math.floor(daysPassed)
      simulationTable.push({
        simBlock: simblock,
        simDay: day,
        dcrBalance: dcrBalance,
        reward: Number(rewardMyMap.get(simblock)) * ticketsPurchased,
        returnedFund: ticketPrice * ticketsPurchased,
        ticketPrice: this.theoreticalTicketPrice(simblock, coinAdjustmentFactor, currentStakePercent, meanVotingBlock) * ticketAdjustmentFactor
      })

      simblock += this.coinbaseMaturity
      simblock++
    }
    const simulationReward = ((dcrBalance - startingBalance) / startingBalance) * 100
    const excessBlocks = simblock - startingBlockHeight
    const stakingRward = (numberOfBlocks / excessBlocks) * simulationReward
    const overflow = startingBalance * (simulationReward - stakingRward) / 100
    simulationTable[simulationTable.length - 1].dcrBalance -= overflow
    simulationTable[simulationTable.length - 1].simDay -= (simblock - numberOfBlocks - startingBlockHeight) / blocksPerDay
    simulationTable[simulationTable.length - 1].reward -= overflow
    for (let i = simulationTable.length - 1; i > 0; i--) {
      if (simulationTable[i].reward >= 0) {
        break
      }
      simulationTable[i - 1].reward += simulationTable[i].reward
      simulationTable[i].reward = 0
    }
    this.createResultTable(stakingRward, simulationTable, numOfDays, startDate, amount)
  }

  createResultTable (reward, simulationTable, days, startDate, amount) {
    this.daysTextTarget.textContent = parseInt(days)
    // number of periods
    reward = !reward ? 0 : reward
    const totalAmount = reward * amount * 1 / 100
    this.percentageRoiTarget.textContent = reward.toFixed(2)
    this.amountRoiTarget.textContent = totalAmount.toFixed(2)
    if (!simulationTable || simulationTable.length === 0) {
      this.hideAll(this.tableTarget)
    } else {
      this.showAll(this.tableTarget)
    }
    this.tableBodyTarget.innerHTML = ''
    const _this = this
    simulationTable.forEach(item => {
      const exRow = document.importNode(_this.rowTemplateTarget.content, true)
      const fields = exRow.querySelectorAll('td')
      fields[0].innerText = _this.getDateFromDays(startDate, item.simDay)
      fields[1].innerText = item.simBlock
      item.returnedFund = !item.returnedFund ? 0 : item.returnedFund
      item.ticketPrice = !item.ticketPrice ? 0 : item.ticketPrice
      item.reward = !item.reward ? 0 : item.reward
      fields[2].innerText = item.ticketPrice.toFixed(2)
      fields[3].innerText = item.returnedFund.toFixed(2)
      fields[4].innerText = item.reward.toFixed(2)
      fields[5].innerText = item.dcrBalance.toFixed(2)
      fields[6].innerText = (100 * (item.dcrBalance - amount) / amount).toFixed(2)
      fields[7].innerText = item.ticketsPurchased ? item.ticketsPurchased : 0
      _this.tableBodyTarget.appendChild(exRow)
    })
  }

  theoreticalTicketPrice (blocknum, coinAdjustmentFactor, currentStakePercent, meanVotingBlock) {
    const projectedCoinsCirculating = this.maxCoinSupplyAtBlock(blocknum) * coinAdjustmentFactor * currentStakePercent
    const ticketPoolSize = (meanVotingBlock + this.ticketMaturity + this.coinbaseMaturity) * this.ticketsPerBlock
    return projectedCoinsCirculating / ticketPoolSize
  }

  maxCoinSupplyAtBlock (blocknum) {
    const maxSupply = (-(9 / (1e19)) * Math.pow(blocknum, 4) + (7 / (1e12)) * Math.pow(blocknum, 3) -
      (2 / (1e5)) * Math.pow(blocknum, 2) + 29.757 * blocknum + 76963 + 1680000) // Premine 1.68M
    return maxSupply
  }

  calcMeanVotingBlocks () {
    const logPoolSizeM1 = Math.log(this.poolSize - 1)
    const logPoolSize = Math.log(this.poolSize)
    let v = 0
    for (let i = 0; i <= this.ticketExpiry; i++) {
      v += Math.exp(Math.log(i) + (i - 1) * logPoolSizeM1 - i * logPoolSize)
    }
    return v
  }

  // Calculate and response
  async calculate () {
    const amount = parseFloat(this.amountTarget.value)
    if (!(amount > 0)) {
      this.amountErrorTarget.textContent = 'Amount must be greater than 0'
      return
    }
    this.amountErrorTarget.textContent = ''

    let startDate = new Date(this.startDateTarget.value)
    let endDate = new Date(this.endDateTarget.value)
    startDate = new Date(startDate.setUTCHours(0, 0, 0, 0))
    endDate = new Date(endDate.setUTCHours(0, 0, 0, 0))
    const days = this.getDaysOfRange(startDate, endDate)
    if (days < this.rewardPeriod) {
      this.startDateErrTarget.textContent = `You must stake for more than ${this.rewardPeriod} days`
      return
    }
    this.startDateErrTarget.textContent = ''
    this.updateQueryString()
    this.handlerRewardCalculator(days, startDate, amount)
  }
}
