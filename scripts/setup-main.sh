#!/bin/bash

SESSION='main'

tmux has-session -t $SESSION 2>/dev/null

if [ $? != 0 ]; then
    tmux new-session -d -s $SESSION

    tmux rename-window 'home'
    tmux send-keys -t $SESSION:0 'home' C-m

    tmux new-window -t $SESSION -n 'docs'
    tmux send-keys -t $SESSION:1 'cd $HOME/Projects/documentation && lls' C-m

    tmux new-window -t $SESSION -n 'llm'
    tmux send-keys -t $SESSION:2 'ollama run gemma3' C-m

    tmux new-window -t $SESSION -n 'tinker'
    tmux send-keys -t $SESSION:3 'update' C-m

    tmux set-option -t $SESSION status on
fi

tmux select-window -t $SESSION:0

tmux attach-session -t $SESSION
