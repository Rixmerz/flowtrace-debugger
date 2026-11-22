// The Rust half of a hop: what a storage engine behind an FFI or a CLI looks like
// to its Python caller. No FlowTrace code here: the trace comes from the build.
fn main() {
    println!("{}", handle("req-1"));
}

fn handle(id: &str) -> usize {
    lookup(id) + 1
}

fn lookup(id: &str) -> usize {
    id.len()
}
