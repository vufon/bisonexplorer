package internal

import (
	"fmt"

	"github.com/decred/dcrdata/v8/db/dbtypes"
	"github.com/decred/dcrdata/v8/mutilchain"
)

// The names of table column indexes are defined in this block.
const (
	// blocks table

	IndexOfBlocksTableOnHash   = "uix_block_hash"
	IndexOfBlocksTableOnHeight = "uix_block_height"
	IndexOfBlocksTableOnTime   = "uix_block_time"

	// transactions table

	IndexOfTransactionsTableOnHashes      = "uix_tx_hashes"
	IndexOfTransactionsTableOnBlockInd    = "uix_tx_block_in"
	IndexOfTransactionsTableOnBlockHeight = "ix_tx_block_height"

	// vins table

	IndexOfVinsTableOnVin     = "uix_vin"
	IndexOfVinsTableOnPrevOut = "uix_vin_prevout"

	// vouts table

	IndexOfVoutsTableOnTxHashInd = "uix_vout_txhash_ind"
	IndexOfVoutsTableOnSpendTxID = "uix_vout_spendtxid_ind"

	// addresses table

	IndexOfAddressTableOnAddress    = "uix_addresses_address"
	IndexOfAddressTableOnVoutID     = "uix_addresses_vout_id"
	IndexOfAddressTableOnBlockTime  = "block_time_index"
	IndexOfAddressTableOnTx         = "uix_addresses_funding_tx"
	IndexOfAddressTableOnMatchingTx = "matching_tx_hash_index"

	// tickets table

	IndexOfTicketsTableOnHashes     = "uix_ticket_hashes_index"
	IndexOfTicketsTableOnTxRowID    = "uix_ticket_ticket_db_id"
	IndexOfTicketsTableOnPoolStatus = "uix_tickets_pool_status"

	// votes table

	IndexOfVotesTableOnHashes    = "uix_votes_hashes_index"
	IndexOfVotesTableOnBlockHash = "uix_votes_block_hash"
	IndexOfVotesTableOnCandBlock = "uix_votes_candidate_block"
	IndexOfVotesTableOnVersion   = "uix_votes_vote_version"
	IndexOfVotesTableOnHeight    = "uix_votes_height"
	IndexOfVotesTableOnBlockTime = "uix_votes_block_time"

	// misses table

	IndexOfMissesTableOnHashes = "uix_misses_hashes_index"

	// agendas table

	IndexOfAgendasTableOnName = "uix_agendas_name"

	// proposal_meta table

	IndexOfProposalMetaTableOnToken = "uix_proposal_meta_token"

	// agenda_votes table

	IndexOfAgendaVotesTableOnRowIDs = "uix_agenda_votes"

	// tspend_votes table
	IndexOfTSpendVotesTableOnRowIDs = "uix_tspend_votes"

	// stats table

	IndexOfHeightOnStatsTable = "uix_stats_height" // REMOVED

	// treasury table

	IndexOfTreasuryTableOnTxHash = "uix_treasury_tx_hash"
	IndexOfTreasuryTableOnHeight = "idx_treasury_height"
)

// AddressesIndexNames are the names of the indexes on the addresses table.
var AddressesIndexNames = []string{IndexOfAddressTableOnAddress,
	IndexOfAddressTableOnVoutID, IndexOfAddressTableOnBlockTime,
	IndexOfAddressTableOnTx, IndexOfAddressTableOnMatchingTx}

func GetMutilchainAddressesIndexNames(chainType string) []string {
	res := make([]string, 0)
	if chainType == mutilchain.TYPEXMR {
		res = append(res, "idx_xmraddresses_global_index")
		res = append(res, "idx_xmraddresses_key_image")
		res = append(res, "idx_xmraddresses_address_idx")
	} else {
		res = append(res, fmt.Sprintf("uix_%saddresses_funding_tx", chainType))
		res = append(res, fmt.Sprintf("uix_%saddresses_vout_id", chainType))
		res = append(res, fmt.Sprintf("uix_%saddresses_address", chainType))
	}
	return res
}

func GetMutilchainIndexDescriptionsMap(chainType string) map[string]string {
	result := make(map[string]string)
	tempIndex := fmt.Sprintf("uix_%sblock_hash", chainType)
	result[tempIndex] = fmt.Sprintf("create %s index on %s", tempIndex, chainType)

	tempIndex = fmt.Sprintf("uix_%sblock_all_hash", chainType)
	result[tempIndex] = fmt.Sprintf("create %s index on %s", tempIndex, chainType)

	tempIndex = fmt.Sprintf("uix_%sblock_height", chainType)
	result[tempIndex] = fmt.Sprintf("create %s index on %s", tempIndex, chainType)

	tempIndex = fmt.Sprintf("uix_%sblock_all_height", chainType)
	result[tempIndex] = fmt.Sprintf("create %s index on %s", tempIndex, chainType)

	tempIndex = fmt.Sprintf("uix_%sblock_time", chainType)
	result[tempIndex] = fmt.Sprintf("create %s index on %s", tempIndex, chainType)

	tempIndex = fmt.Sprintf("uix_%sblock_all_time", chainType)
	result[tempIndex] = fmt.Sprintf("create %s index on %s", tempIndex, chainType)

	tempIndex = fmt.Sprintf("ix_%stx_block_height", chainType)
	result[tempIndex] = fmt.Sprintf("create %s index on %s", tempIndex, chainType)

	tempIndex = fmt.Sprintf("uix_%stx_txhash", chainType)
	result[tempIndex] = fmt.Sprintf("create %s index on %s", tempIndex, chainType)

	tempIndex = fmt.Sprintf("uix_%stx_hash_blhash", chainType)
	result[tempIndex] = fmt.Sprintf("create %s index on %s", tempIndex, chainType)

	tempIndex = fmt.Sprintf("uix_%svin_prevout", chainType)
	result[tempIndex] = fmt.Sprintf("create %s index on %s", tempIndex, chainType)

	tempIndex = fmt.Sprintf("uix_%svin_all_prevout", chainType)
	result[tempIndex] = fmt.Sprintf("create %s index on %s", tempIndex, chainType)

	tempIndex = fmt.Sprintf("uix_%svin", chainType)
	result[tempIndex] = fmt.Sprintf("create %s index on %s", tempIndex, chainType)

	tempIndex = fmt.Sprintf("uix_%svin_all_txhash_txindex", chainType)
	result[tempIndex] = fmt.Sprintf("create %s index on %s", tempIndex, chainType)

	tempIndex = fmt.Sprintf("uix_%svout_txhash", chainType)
	result[tempIndex] = fmt.Sprintf("create %s index on %s", tempIndex, chainType)

	tempIndex = fmt.Sprintf("uix_%svout_all_txhash", chainType)
	result[tempIndex] = fmt.Sprintf("create %s index on %s", tempIndex, chainType)

	tempIndex = fmt.Sprintf("uix_%svout_txhash_ind", chainType)
	result[tempIndex] = fmt.Sprintf("create %s index on %s", tempIndex, chainType)

	tempIndex = fmt.Sprintf("uix_%svout_all_txhash_ind", chainType)
	result[tempIndex] = fmt.Sprintf("create %s index on %s", tempIndex, chainType)

	if chainType == mutilchain.TYPEXMR {
		tempIndex = "uix_monero_outputs_txhash"
		result[tempIndex] = fmt.Sprintf("create %s index on monero", tempIndex)

		tempIndex = "uix_monero_outputs_global_index"
		result[tempIndex] = fmt.Sprintf("create %s index on monero", tempIndex)

		tempIndex = "uix_monero_outputs_out_pk"
		result[tempIndex] = fmt.Sprintf("create %s index on monero", tempIndex)

		tempIndex = "uix_monero_key_images_block_height"
		result[tempIndex] = fmt.Sprintf("create %s index on monero", tempIndex)

		tempIndex = "uix_monero_ring_members_txhash_txinput_idx"
		result[tempIndex] = fmt.Sprintf("create %s index on monero", tempIndex)

		tempIndex = "uix_monero_ring_members_member_global_idx"
		result[tempIndex] = fmt.Sprintf("create %s index on monero", tempIndex)

		tempIndex = "idx_xmraddresses_global_index"
		result[tempIndex] = fmt.Sprintf("create %s index on monero", tempIndex)

		tempIndex = "idx_xmraddresses_key_image"
		result[tempIndex] = fmt.Sprintf("create %s index on monero", tempIndex)

		tempIndex = "idx_xmraddresses_address_idx"
		result[tempIndex] = fmt.Sprintf("create %s index on monero", tempIndex)

		tempIndex = "idx_xmraddresses_out_pk"
		result[tempIndex] = fmt.Sprintf("create %s index on monero", tempIndex)

		tempIndex = "idx_xmraddresses_amount_known"
		result[tempIndex] = fmt.Sprintf("create %s index on monero", tempIndex)

		tempIndex = "idx_xmraddresses_vout_row_id"
		result[tempIndex] = fmt.Sprintf("create %s index on monero", tempIndex)

		tempIndex = "idx_xmraddresses_funding_tx"
		result[tempIndex] = fmt.Sprintf("create %s index on monero", tempIndex)
	} else {
		tempIndex = fmt.Sprintf("uix_%saddresses_addr_vout_row_id", chainType)
		result[tempIndex] = fmt.Sprintf("create %s index on %s", tempIndex, chainType)

		tempIndex = fmt.Sprintf("uix_%saddresses_funding_tx", chainType)
		result[tempIndex] = fmt.Sprintf("create %s index on %s", tempIndex, chainType)

		tempIndex = fmt.Sprintf("uix_%saddresses_address", chainType)
		result[tempIndex] = fmt.Sprintf("create %s index on %s", tempIndex, chainType)

		tempIndex = fmt.Sprintf("uix_%saddresses_vout_id", chainType)
		result[tempIndex] = fmt.Sprintf("create %s index on %s", tempIndex, chainType)
	}
	return result
}

func GetIndexDescriptionsMap() map[string]string {
	result := make(map[string]string)
	for key, value := range IndexDescriptions {
		result[key] = value
	}
	//add mutilchain index description
	for _, chainType := range dbtypes.MutilchainList {
		tempIndex := fmt.Sprintf("uix_%sblock_hash", chainType)
		result[tempIndex] = fmt.Sprintf("create %s index on %s", tempIndex, chainType)

		tempIndex = fmt.Sprintf("uix_%sblock_all_hash", chainType)
		result[tempIndex] = fmt.Sprintf("create %s index on %s", tempIndex, chainType)

		tempIndex = fmt.Sprintf("uix_%sblock_height", chainType)
		result[tempIndex] = fmt.Sprintf("create %s index on %s", tempIndex, chainType)

		tempIndex = fmt.Sprintf("uix_%sblock_all_height", chainType)
		result[tempIndex] = fmt.Sprintf("create %s index on %s", tempIndex, chainType)

		tempIndex = fmt.Sprintf("uix_%sblock_time", chainType)
		result[tempIndex] = fmt.Sprintf("create %s index on %s", tempIndex, chainType)

		tempIndex = fmt.Sprintf("uix_%sblock_all_time", chainType)
		result[tempIndex] = fmt.Sprintf("create %s index on %s", tempIndex, chainType)

		tempIndex = fmt.Sprintf("ix_%stx_block_height", chainType)
		result[tempIndex] = fmt.Sprintf("create %s index on %s", tempIndex, chainType)

		tempIndex = fmt.Sprintf("uix_%stx_txhash", chainType)
		result[tempIndex] = fmt.Sprintf("create %s index on %s", tempIndex, chainType)

		tempIndex = fmt.Sprintf("uix_%stx_hash_blhash", chainType)
		result[tempIndex] = fmt.Sprintf("create %s index on %s", tempIndex, chainType)

		tempIndex = fmt.Sprintf("uix_%svin_prevout", chainType)
		result[tempIndex] = fmt.Sprintf("create %s index on %s", tempIndex, chainType)

		tempIndex = fmt.Sprintf("uix_%svin_all_prevout", chainType)
		result[tempIndex] = fmt.Sprintf("create %s index on %s", tempIndex, chainType)

		tempIndex = fmt.Sprintf("uix_%svin", chainType)
		result[tempIndex] = fmt.Sprintf("create %s index on %s", tempIndex, chainType)

		tempIndex = fmt.Sprintf("uix_%svin_all_txhash_txindex", chainType)
		result[tempIndex] = fmt.Sprintf("create %s index on %s", tempIndex, chainType)

		tempIndex = fmt.Sprintf("uix_%svout_txhash", chainType)
		result[tempIndex] = fmt.Sprintf("create %s index on %s", tempIndex, chainType)

		tempIndex = fmt.Sprintf("uix_%svout_all_txhash", chainType)
		result[tempIndex] = fmt.Sprintf("create %s index on %s", tempIndex, chainType)

		tempIndex = fmt.Sprintf("uix_%svout_txhash_ind", chainType)
		result[tempIndex] = fmt.Sprintf("create %s index on %s", tempIndex, chainType)

		tempIndex = fmt.Sprintf("uix_%svout_all_txhash_ind", chainType)
		result[tempIndex] = fmt.Sprintf("create %s index on %s", tempIndex, chainType)

		if chainType == mutilchain.TYPEXMR {
			tempIndex = "uix_monero_outputs_txhash"
			result[tempIndex] = fmt.Sprintf("create %s index on monero", tempIndex)

			tempIndex = "uix_monero_outputs_global_index"
			result[tempIndex] = fmt.Sprintf("create %s index on monero", tempIndex)

			tempIndex = "uix_monero_outputs_out_pk"
			result[tempIndex] = fmt.Sprintf("create %s index on monero", tempIndex)

			tempIndex = "uix_monero_key_images_block_height"
			result[tempIndex] = fmt.Sprintf("create %s index on monero", tempIndex)

			tempIndex = "uix_monero_ring_members_txhash_txinput_idx"
			result[tempIndex] = fmt.Sprintf("create %s index on monero", tempIndex)

			tempIndex = "uix_monero_ring_members_member_global_idx"
			result[tempIndex] = fmt.Sprintf("create %s index on monero", tempIndex)

			tempIndex = "idx_xmraddresses_global_index"
			result[tempIndex] = fmt.Sprintf("create %s index on monero", tempIndex)

			tempIndex = "idx_xmraddresses_key_image"
			result[tempIndex] = fmt.Sprintf("create %s index on monero", tempIndex)

			tempIndex = "idx_xmraddresses_address_idx"
			result[tempIndex] = fmt.Sprintf("create %s index on monero", tempIndex)

			tempIndex = "idx_xmraddresses_out_pk"
			result[tempIndex] = fmt.Sprintf("create %s index on monero", tempIndex)

			tempIndex = "idx_xmraddresses_amount_known"
			result[tempIndex] = fmt.Sprintf("create %s index on monero", tempIndex)

			tempIndex = "idx_xmraddresses_vout_row_id"
			result[tempIndex] = fmt.Sprintf("create %s index on monero", tempIndex)

			tempIndex = "idx_xmraddresses_funding_tx"
			result[tempIndex] = fmt.Sprintf("create %s index on monero", tempIndex)
		} else {
			tempIndex = fmt.Sprintf("uix_%saddresses_addr_vout_row_id", chainType)
			result[tempIndex] = fmt.Sprintf("create %s index on %s", tempIndex, chainType)

			tempIndex = fmt.Sprintf("uix_%saddresses_funding_tx", chainType)
			result[tempIndex] = fmt.Sprintf("create %s index on %s", tempIndex, chainType)

			tempIndex = fmt.Sprintf("uix_%saddresses_address", chainType)
			result[tempIndex] = fmt.Sprintf("create %s index on %s", tempIndex, chainType)

			tempIndex = fmt.Sprintf("uix_%saddresses_vout_id", chainType)
			result[tempIndex] = fmt.Sprintf("create %s index on %s", tempIndex, chainType)
		}
	}
	return result
}

// IndexDescriptions relate table index names to descriptions of the indexes.
var IndexDescriptions = map[string]string{
	IndexOfBlocksTableOnHash:              "blocks on hash",
	IndexOfBlocksTableOnHeight:            "blocks on height",
	IndexOfTransactionsTableOnHashes:      "transactions on block hash and transaction hash",
	IndexOfTransactionsTableOnBlockInd:    "transactions on block hash, block index, and tx tree",
	IndexOfTransactionsTableOnBlockHeight: "transactions on block height",
	IndexOfVinsTableOnVin:                 "vins on transaction hash and index",
	IndexOfVinsTableOnPrevOut:             "vins on previous outpoint",
	IndexOfVoutsTableOnTxHashInd:          "vouts on transaction hash and index",
	IndexOfVoutsTableOnSpendTxID:          "vouts on spend_tx_row_id",
	IndexOfAddressTableOnAddress:          "addresses table on address", // TODO: remove if it is redundant with IndexOfAddressTableOnVoutID
	IndexOfAddressTableOnVoutID:           "addresses table on vout row id, address, and is_funding",
	IndexOfAddressTableOnBlockTime:        "addresses table on block time",
	IndexOfAddressTableOnTx:               "addresses table on transaction hash",
	IndexOfAddressTableOnMatchingTx:       "addresses table on matching tx hash",
	IndexOfTicketsTableOnHashes:           "tickets table on block hash and transaction hash",
	IndexOfTicketsTableOnTxRowID:          "tickets table on transactions table row ID",
	IndexOfTicketsTableOnPoolStatus:       "tickets table on pool status",
	IndexOfVotesTableOnHashes:             "votes table on block hash and transaction hash",
	IndexOfVotesTableOnBlockHash:          "votes table on block hash",
	IndexOfVotesTableOnCandBlock:          "votes table on candidate block",
	IndexOfVotesTableOnVersion:            "votes table on vote version",
	IndexOfVotesTableOnHeight:             "votes table on height",
	IndexOfVotesTableOnBlockTime:          "votes table on block time",
	IndexOfMissesTableOnHashes:            "misses on ticket hash and block hash",
	IndexOfAgendasTableOnName:             "agendas on agenda name",
	IndexOfAgendaVotesTableOnRowIDs:       "agenda_votes on votes table row ID and agendas table row ID",
	IndexOfTreasuryTableOnTxHash:          "treasury table on tx hash",
	IndexOfTreasuryTableOnHeight:          "treasury table on block height",
}
