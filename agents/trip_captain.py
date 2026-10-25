"""Start every Travel Assist AI agent and register each mailbox on Agentverse.

Stop any copy already running, then from the repo root:

    .venv\\Scripts\\python.exe agents\\trip_captain.py

Open each inspector link the script prints and choose Connect, then Mailbox.
"""

from crew import main

if __name__ == "__main__":
    main()
