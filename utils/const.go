package utils

const (
	// swap type
	CONTRACT_TYPE        = "contract"
	REDEMPTION_TYPE      = "redemption"
	REFUND_TYPE          = "refund"
	AtomicUnit           = 1e12
	InitialEmission      = 17640000 * AtomicUnit
	TailStartHeight      = 2641623
	TailEmissionPerBlock = 60 * 1e10
	TimeFmt              = "2006-01-02 15:04:05 (MST)"
)

var AgendasDetail = map[string][]string{
	"lnsupport":            {"Start Lightning Network Support", "The [[Lightning Network((https://lightning.network))]] is the most directly useful application of smart contracts to date since it allows for off-chain transactions that optionally settle on-chain. This infrastructure has clear benefits for both scaling and privacy. Decred is optimally positioned for this integration."},
	"sdiffalgorithm":       {"Change PoS Staking Algorithm", "Specifies a proposed replacement algorithm for determining the stake difficulty (commonly called the ticket price). This proposal resolves all issues with a new algorithm that adheres to the referenced ideals."},
	"lnfeatures":           {"Enable Lightning Network Features", "The [[Lightning Network((https://lightning.network))]] is the most directly useful application of smart contracts to date since it allows for off-chain transactions that optionally settle on-chain. This infrastructure has clear benefits for both scaling and privacy. Decred is optimally positioned for this integration."},
	"fixlnseqlocks":        {"Update Sequence Lock Rules", "In order to fully support the [[Lightning Network((https://lightning.network))]], the current sequence lock consensus rules need to be modified."},
	"headercommitments":    {"Enable Block Header Commitments", "Proposed modifications to the Decred block header to increase the security and efficiency of lightweight clients, as well as adding infrastructure to enable future scalability enhancements."},
	"treasury":             {"Enable Decentralized Treasury", "In May 2019, Decred stakeholders approved the development of [[a proposed solution((https://proposals.decred.org/proposals/c96290a))]] to further decentralize the process of spending from the Decred treasury."},
	"changesubsidysplit":   {"Change PoW/PoS Subsidy Split To 10/80", "[[Proposal((https://proposals.decred.org/record/427e1d4))]] to modify to the block reward subsidy split such that 10% goes to Proof-of-Work and 80% goes to Proof-of-Stake."},
	"autorevocations":      {"Automatic Ticket Revocations", "Changes to ticket revocation transactions and block acceptance criteria in order to enable [[automatic ticket revocations((https://proposals.decred.org/record/e2d7b7d))]], significantly improving the user experience for stakeholders."},
	"explicitverupgrades":  {"Explicit Version Upgrades", "Modifications to Decred transaction and scripting language version enforcement which will simplify deployment and integration of future consensus changes across the Decred ecosystem."},
	"reverttreasurypolicy": {"Revert Treasury Expenditure Policy", "Change the algorithm used to calculate Treasury spending limits such that it enforces the policy originally approved by stakeholders in the [[Decentralized Treasury proposal.((https://proposals.decred.org/proposals/c96290a))]]"},
	"changesubsidysplitr2": {"Change PoW/PoS Subsidy Split To 1/89", "Modify the block reward subsidy split such that 1% goes to Proof-of-Work (PoW) and 89% goes to Proof-of-Stake (PoS). The Treasury subsidy remains at 10%."},
	"blake3pow":            {"Change PoW to BLAKE3 and ASERT", "[[Stakeholders voted((https://proposals.decred.org/record/a8501bc))]] to change the Proof-of-Work hash function to BLAKE3. This consensus change will also update the difficulty algorithm to ASERT (Absolutely Scheduled Exponentially weighted Rising Targets)."},
}

var DCPLink = map[string]string{
	"DCP0001": "https://github.com/decred/dcps/blob/master/dcp-0001/dcp-0001.mediawiki",
	"DCP0002": "https://github.com/decred/dcps/blob/master/dcp-0002/dcp-0002.mediawiki",
	"DCP0003": "https://github.com/decred/dcps/blob/master/dcp-0003/dcp-0003.mediawiki",
	"DCP0004": "https://github.com/decred/dcps/blob/master/dcp-0004/dcp-0004.mediawiki",
	"DCP0005": "https://github.com/decred/dcps/blob/master/dcp-0005/dcp-0005.mediawiki",
	"DCP0006": "https://github.com/decred/dcps/blob/master/dcp-0006/dcp-0006.mediawiki",
	"DCP0007": "https://github.com/decred/dcps/blob/master/dcp-0007/dcp-0007.mediawiki",
	"DCP0008": "https://github.com/decred/dcps/blob/master/dcp-0008/dcp-0008.mediawiki",
	"DCP0009": "https://github.com/decred/dcps/blob/master/dcp-0009/dcp-0009.mediawiki",
	"DCP0010": "https://github.com/decred/dcps/blob/master/dcp-0010/dcp-0010.mediawiki",
	"DCP0011": "https://github.com/decred/dcps/blob/master/dcp-0011/dcp-0011.mediawiki",
	"DCP0012": "https://github.com/decred/dcps/blob/master/dcp-0012/dcp-0012.mediawiki",
}
