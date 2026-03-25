from django.db import models


class StockRecord(models.Model):
    symbol = models.CharField(max_length=20, db_index=True)
    name = models.CharField(max_length=50)
    price = models.FloatField()
    time = models.DateTimeField(db_index=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['-time']
        indexes = [
            models.Index(fields=['symbol', 'time']),
        ]

    def __str__(self):
        return f"{self.name} ({self.symbol}) {self.price} @ {self.time}"
