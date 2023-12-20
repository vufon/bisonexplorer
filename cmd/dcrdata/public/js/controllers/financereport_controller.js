import { Controller } from '@hotwired/stimulus'

export default class extends Controller {
  static get targets () {
    return ['type', 'proposal', 'domain']
  }

  async initialize () {
    this.typeTargets.name = 'proposal'
  }

  typeChange (e) {
    const target = e.srcElement || e.target
    this.typeTargets.forEach((typeTarget) => {
      typeTarget.classList.remove('btn-active')
    })
    target.classList.add('btn-active')
    if (e.target.name === 'proposal') {
      this.proposalTarget.classList.remove('d-none')
      this.domainTarget.classList.add('d-none')
    } else {
      this.domainTarget.classList.remove('d-none')
      this.proposalTarget.classList.add('d-none')
    }
  }
}
