"""prepare.py 
Frozen evaluator for Karpathy-loop sample experiments.
(DO NOT ALLOW THE AGENT TO EDIT THIS FILE)
"""
import torch
import torch.nn as nn

DATASET_SEED = 1337
SPLIT_SEED = 1338
SHUFFLE_SEED = 1339

# 1. Data Loading Protocol
def get_dataloaders(batch_size=32):
    """Loads and provides the dataset. This must remain constant across all experiments."""
    # (Example: Synthetic dataset for demonstration)
    data_gen = torch.Generator().manual_seed(DATASET_SEED)
    X = torch.randn(1000, 10, generator=data_gen)
    y = torch.randint(0, 2, (1000,), generator=data_gen)
    dataset = torch.utils.data.TensorDataset(X, y)
    
    train_size = int(0.8 * len(dataset))
    val_size = len(dataset) - train_size
    split_gen = torch.Generator().manual_seed(SPLIT_SEED)
    train_dataset, val_dataset = torch.utils.data.random_split(
        dataset, [train_size, val_size], generator=split_gen
    )

    shuffle_gen = torch.Generator().manual_seed(SHUFFLE_SEED)
    train_loader = torch.utils.data.DataLoader(
        train_dataset,
        batch_size=batch_size,
        shuffle=True,
        generator=shuffle_gen,
    )
    val_loader = torch.utils.data.DataLoader(val_dataset, batch_size=batch_size, shuffle=False)
    
    return train_loader, val_loader

# 2. Validation Metric (The Objective Score)
def evaluate_model(model, val_loader):
    """The strict, objectively testable metric (e.g., bits-per-byte or standard loss)."""
    model.eval()
    criterion = nn.CrossEntropyLoss()
    total_loss = 0.0
    total_samples = 0

    with torch.no_grad():
        for inputs, targets in val_loader:
            outputs = model(inputs)
            loss = criterion(outputs, targets)
            batch_size = targets.size(0)
            total_loss += loss.item() * batch_size
            total_samples += batch_size

    # Return the exact metric the agent needs to minimize/maximize
    if total_samples == 0:
        raise ValueError("Validation loader produced zero samples.")
    return total_loss / total_samples
