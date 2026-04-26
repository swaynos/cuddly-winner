"""train.py 
Mutable training target for Karpathy-loop sample experiments.
(THE AGENT HAS FULL CONTROL OVER THIS FILE)
"""
import time
from pathlib import Path

import torch
import torch.nn as nn
import torch.optim as optim
from prepare import get_dataloaders, evaluate_model

# 1. Hard-Coded Time Budget
# Normalizes experiments so architectural changes are directly comparable
MAX_TRAIN_TIME_SECONDS = 300 # 5 minutes
TRAIN_SEED = 2026

# 2. Mutable Model Architecture
class SimpleNet(nn.Module):
    def __init__(self):
        super(SimpleNet, self).__init__()
        # The agent can modify layers, attention depth, etc.
        self.fc1 = nn.Linear(10, 50) 
        self.relu = nn.ReLU()
        self.fc2 = nn.Linear(50, 2)

    def forward(self, x):
        x = self.fc1(x)
        x = self.relu(x)
        x = self.fc2(x)
        return x

def run_experiment():
    torch.manual_seed(TRAIN_SEED)
    train_loader, val_loader = get_dataloaders(batch_size=32)
    model = SimpleNet()
    
    # 3. Mutable Optimizers (Agent can swap to AdamW, Muon, etc.)
    optimizer = optim.AdamW(model.parameters(), lr=0.001)
    criterion = nn.CrossEntropyLoss()
    
    start_time = time.time()
    
    # 4. The Training Loop (Constrained by time)
    model.train()
    epoch = 0
    while time.time() - start_time < MAX_TRAIN_TIME_SECONDS:
        for inputs, targets in train_loader:
            # Enforce time limit inside the batch loop
            if time.time() - start_time >= MAX_TRAIN_TIME_SECONDS:
                break
                
            optimizer.zero_grad()
            outputs = model(inputs)
            loss = criterion(outputs, targets)
            loss.backward()
            optimizer.step()
        epoch += 1

    # 5. Final Evaluation using the Immutable Judge
    final_score = evaluate_model(model, val_loader)
    print(f"EXPERIMENT COMPLETE. Epochs run: {epoch}. Final Score: {final_score}")
    
    # Log the score to a file so the agent's bash script can read it
    logs_dir = Path("logs")
    logs_dir.mkdir(parents=True, exist_ok=True)
    with open(logs_dir / "latest_score.txt", "w") as f:
        f.write(str(final_score))

if __name__ == "__main__":
    run_experiment()
