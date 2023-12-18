import { Controller } from '@hotwired/stimulus'

export default class extends Controller {
  static get targets () {
    return []
  }

  async initialize () {
    console.log('finance report js')
  }
}
