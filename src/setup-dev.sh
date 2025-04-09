#!/bin/bash

SESSION='dev'

tmux has-session -t $SESSION 2>/dev/null

if [ $? != 0 ]; then
    tmux new-session -d -s $SESSION

    tmux rename-window 'home'
    tmux send-keys -t $SESSION:0 'home' C-m

    tmux new-window -t $SESSION -n 'llm'
    tmux send-keys -t $SESSION:2 'ollama run gemma3' C-m

    tmux new-window -t $SESSION -n 'leetcode'
    tmux send-keys -t $SESSION:2 'cd $HOME/Projects/leetcode-solutions && lls' C-m

    tmux new-window -t $SESSION -n 'projects'
    tmux send-keys -t $SESSION:3 'cd $HOME/Projects/ && lls' C-m

    tmux set-option -t $SESSION status on
fi

tmux select-window -t $SESSION:0

tmux attach-session -t $SESSION
