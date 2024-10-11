import { Controller } from '@hotwired/stimulus'
import { requestJSON } from '../helpers/http'

export default class FinanceReportController extends Controller {
  static values = {
    reportMinYear: Number,
    reportMaxYear: Number,
    reportMinMonth: Number,
    reportMaxMonth: Number
  }

  async initReportTimeRange () {
    // Get time range of reports
    const url = '/api/finance-report/time-range'
    const timeRangeRes = await requestJSON(url)
    if (!timeRangeRes) {
      return
    }
    this.reportMinYear = timeRangeRes.minYear
    this.reportMinMonth = timeRangeRes.minMonth
    this.reportMaxYear = timeRangeRes.maxYear
    this.reportMaxMonth = timeRangeRes.maxMonth
  }
}
