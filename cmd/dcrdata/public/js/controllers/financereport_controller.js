import { Controller } from '@hotwired/stimulus'

export default class extends Controller {
  static get targets () {
    return ['type', 'proposal', 'proposal2', 'proposal3', 'domain', 'treasury', 'reportTitle']
  }

  async initialize () {
    this.typeTargets.name = 'proposal'
    this.reportTitleTarget.textContent = 'Finance Report - Proposal Example 1'
  }

  typeChange (e) {
    const target = e.srcElement || e.target
    this.typeTargets.forEach((typeTarget) => {
      typeTarget.classList.remove('btn-active')
    })
    target.classList.add('btn-active')
    switch (e.target.name) {
      case 'proposal':
        this.proposalTarget.classList.remove('d-none')
        this.domainTarget.classList.add('d-none')
        this.treasuryTarget.classList.add('d-none')
        this.proposal2Target.classList.add('d-none')
        this.proposal3Target.classList.add('d-none')
        this.reportTitleTarget.textContent = 'Finance Report - Proposal Example 1'
        break
      case 'proposal2':
        this.proposalTarget.classList.add('d-none')
        this.domainTarget.classList.add('d-none')
        this.treasuryTarget.classList.add('d-none')
        this.proposal2Target.classList.remove('d-none')
        this.proposal3Target.classList.add('d-none')
        this.reportTitleTarget.textContent = 'Finance Report - Proposal All'
        break
      case 'proposal3':
        this.proposalTarget.classList.add('d-none')
        this.domainTarget.classList.add('d-none')
        this.treasuryTarget.classList.add('d-none')
        this.proposal2Target.classList.add('d-none')
        this.proposal3Target.classList.remove('d-none')
        this.reportTitleTarget.textContent = 'Finance Report - Proposal Summary'
        break
      case 'domain':
        this.proposalTarget.classList.add('d-none')
        this.domainTarget.classList.remove('d-none')
        this.treasuryTarget.classList.add('d-none')
        this.proposal2Target.classList.add('d-none')
        this.proposal3Target.classList.add('d-none')
        this.reportTitleTarget.textContent = 'Finance Report - Domain Stats'
        break
      case 'treasury':
        this.proposalTarget.classList.add('d-none')
        this.domainTarget.classList.add('d-none')
        this.treasuryTarget.classList.remove('d-none')
        this.proposal2Target.classList.add('d-none')
        this.proposal3Target.classList.add('d-none')
        this.reportTitleTarget.textContent = 'Finance Report - Treasury Stats'
    }
  }
}
