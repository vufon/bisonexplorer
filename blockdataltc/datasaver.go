// Copyright (c) 2020, The Decred developers
// Copyright (c) 2017, Jonathan Chappelow
// See LICENSE for details.

// Interface for saving/storing BlockData.
// Create a BlockDataSaver by implementing Store(*BlockData).

package blockdataltc

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"sync"

	"github.com/ltcsuite/ltcd/wire"
)

// BlockDataSaver is an interface for saving/storing BlockData
type BlockDataSaver interface {
	Store(*BlockData, *wire.MsgBlock) error
}

// BlockDataToJSONStdOut implements BlockDataSaver interface for JSON output to
// stdout.
type BlockDataToJSONStdOut struct {
	mtx *sync.Mutex
}

type fileSaver struct {
	folder   string
	nameBase string
	file     os.File
	mtx      *sync.Mutex
}

// BlockDataToJSONFiles implements BlockDataSaver interface for JSON output to
// the file system.
type BlockDataToJSONFiles struct {
	fileSaver
}

// NewBlockDataToJSONStdOut creates a new BlockDataToJSONStdOut with optional
// existing mutex.
func NewBlockDataToJSONStdOut(m ...*sync.Mutex) *BlockDataToJSONStdOut {
	if len(m) > 1 {
		panic("Too many inputs.")
	}
	if len(m) > 0 {
		return &BlockDataToJSONStdOut{m[0]}
	}
	return &BlockDataToJSONStdOut{}
}

// NewBlockDataToJSONFiles creates a new BlockDataToJSONFiles with optional
// existing mutex
func NewBlockDataToJSONFiles(folder string, fileBase string, m ...*sync.Mutex) *BlockDataToJSONFiles {
	if len(m) > 1 {
		panic("Too many inputs.")
	}

	var mtx *sync.Mutex
	if len(m) > 0 {
		mtx = m[0]
	} else {
		mtx = new(sync.Mutex)
	}

	return &BlockDataToJSONFiles{
		fileSaver: fileSaver{
			folder:   folder,
			nameBase: fileBase,
			file:     os.File{},
			mtx:      mtx,
		},
	}
}

// Store writes BlockData to stdout in JSON format
func (s *BlockDataToJSONStdOut) Store(data *BlockData, _ *wire.MsgBlock) error {
	if s.mtx != nil {
		s.mtx.Lock()
		defer s.mtx.Unlock()
	}

	// Marshall all the block data results in to a single JSON object, indented
	jsonConcat, err := JSONFormatBlockData(data)
	if err != nil {
		return err
	}

	// Write JSON to stdout with guards to delimit the object from other text
	fmt.Printf("\n--- BEGIN BlockData JSON ---\n")
	_, err = writeFormattedJSONBlockData(jsonConcat, os.Stdout)
	fmt.Printf("--- END BlockData JSON ---\n\n")

	return err
}

// Store writes BlockData to a file in JSON format
// The file name is nameBase+height+".json".
func (s *BlockDataToJSONFiles) Store(data *BlockData, _ *wire.MsgBlock) error {
	if s.mtx != nil {
		s.mtx.Lock()
		defer s.mtx.Unlock()
	}

	// Marshall all the block data results in to a single JSON object, indented
	jsonConcat, err := JSONFormatBlockData(data)
	if err != nil {
		return err
	}

	// Write JSON to a file with block height in the name
	height := data.Header.Height
	fname := fmt.Sprintf("%s%d.json", s.nameBase, height)
	fullfile := filepath.Join(s.folder, fname)
	fp, err := os.Create(fullfile)
	if err != nil {
		log.Errorf("Unable to open file %v for writing.", fullfile)
		return err
	}
	defer fp.Close()

	s.file = *fp
	_, err = writeFormattedJSONBlockData(jsonConcat, &s.file)

	return err
}

func writeFormattedJSONBlockData(jsonConcat fmt.Stringer, w io.Writer) (int, error) {
	n, err := fmt.Fprintln(w, jsonConcat.String())
	// there was once more, perhaps again.
	return n, err
}

// JSONFormatBlockData concatenates block data results into a single JSON
// object with primary keys for the result type
func JSONFormatBlockData(data *BlockData) (*bytes.Buffer, error) {
	var jsonAll bytes.Buffer
	jsonAll.WriteString("{\"block_header\": ")
	blockHeaderJSON, err := json.Marshal(data.Header)
	if err != nil {
		return nil, err
	}
	jsonAll.Write(blockHeaderJSON)
	jsonAll.WriteString("}")

	var jsonAllIndented bytes.Buffer
	err = json.Indent(&jsonAllIndented, jsonAll.Bytes(), "", "    ")
	if err != nil {
		return nil, err
	}

	return &jsonAllIndented, err
}

// BlockTrigger wraps a simple function of builtin-typed hash and height.
type BlockTrigger struct {
	Async bool
	Saver func(string, uint32) error
}

// Store reduces the block data to the hash and height in builtin types,
// and passes the data to the saver.
func (s BlockTrigger) Store(bd *BlockData, _ *wire.MsgBlock) error {
	if s.Async {
		go func() {
			err := s.Saver(bd.Header.Hash, uint32(bd.Header.Height))
			if err != nil {
				log.Errorf("BlockTrigger: Saver failed: %v", err)
			}
		}()
		return nil
	}
	return s.Saver(bd.Header.Hash, uint32(bd.Header.Height))
}
