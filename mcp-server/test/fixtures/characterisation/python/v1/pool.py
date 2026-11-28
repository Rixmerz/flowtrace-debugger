"""Characterisation fixture: a threaded flow whose sibling order is scheduling.

Each task sleeps a random time, so which worker enters `fetch` first differs
from run to run. The test uses it to pin down what two runs of unchanged
concurrent code compare as.
"""
import random
import time
from concurrent.futures import ThreadPoolExecutor


def fetch(n):
    time.sleep(random.random() / 50)
    return square(n)


def square(n):
    return n * n


def run():
    with ThreadPoolExecutor(max_workers=4) as pool:
        return sum(pool.map(fetch, range(8)))


if __name__ == "__main__":
    run()
