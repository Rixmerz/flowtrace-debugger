package transform

import "fmt"

// edit is a single byte-range replacement against the original source.
// end == start means a pure insertion at that offset; nothing is removed.
// text must never contain a newline — that is what keeps every declaration
// on its original line after splicing (see D2 in the design doc).
type edit struct {
	start int
	end   int
	text  string
}

// applyEdits splices edits into src back-to-front so that offsets computed
// once, up front, from the unmutated AST stay valid for every edit that
// follows. Edits must be non-overlapping in original-source coordinates.
func applyEdits(src []byte, edits []edit) ([]byte, error) {
	ordered := make([]edit, len(edits))
	copy(ordered, edits)
	sortEditsDescending(ordered)

	out := src
	last := len(src)
	for _, e := range ordered {
		if e.start < 0 || e.end < e.start || e.end > len(src) {
			return nil, fmt.Errorf("invalid edit range [%d,%d) in %d-byte source", e.start, e.end, len(src))
		}
		if e.end > last {
			return nil, fmt.Errorf("overlapping edits at offset %d", e.end)
		}
		spliced := make([]byte, 0, len(out)+len(e.text))
		spliced = append(spliced, out[:e.start]...)
		spliced = append(spliced, e.text...)
		spliced = append(spliced, out[e.end:]...)
		out = spliced
		last = e.start
	}
	return out, nil
}

// sortEditsDescending orders edits by start offset, largest first, so
// applyEdits can splice back-to-front. Insertion sort: the edit lists here
// are always small (a handful of edits per function).
func sortEditsDescending(edits []edit) {
	for i := 1; i < len(edits); i++ {
		for j := i; j > 0 && edits[j].start > edits[j-1].start; j-- {
			edits[j], edits[j-1] = edits[j-1], edits[j]
		}
	}
}
