from __future__ import annotations

from redis import Redis
from rq import Queue, Worker

from app.config import REDIS_URL, RQ_QUEUE_NAME


def main() -> None:
    connection = Redis.from_url(REDIS_URL)
    queue = Queue(RQ_QUEUE_NAME, connection=connection)
    worker = Worker([queue], connection=connection)
    worker.work(with_scheduler=True)


if __name__ == "__main__":
    main()
