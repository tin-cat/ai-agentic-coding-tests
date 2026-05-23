<?php

declare(strict_types=1);

namespace Frontstage\Ordering\Infrastructure\Persistence\Doctrine;

use Frontstage\Ordering\Domain\Model\Order\Order;
use Frontstage\Ordering\Domain\Model\Order\OrderId;
use Frontstage\Ordering\Domain\Model\Order\OrderLine;
use Frontstage\Ordering\Domain\Model\Order\OrderStatus;
use Frontstage\Ordering\Domain\Model\Shared\Currency;
use Frontstage\Ordering\Domain\Model\Shared\Money;
use Frontstage\Ordering\Infrastructure\Persistence\Doctrine\Entity\DoctrineOrder;
use Frontstage\Ordering\Infrastructure\Persistence\Doctrine\Entity\DoctrineOrderLine;

/**
 * Converts between the {@see Order} aggregate and its Doctrine persistence
 * model. Orders are append-only at this stage, so the mapping is one-way on
 * write (no diff-based sync needed).
 */
final class OrderMapper
{
	public function toDoctrine(Order $order): DoctrineOrder
	{
		$doctrine = new DoctrineOrder(
			id: $order->id->toString(),
			eventId: $order->eventId,
			holdId: $order->holdId,
			totalAmount: $order->total->amount,
			totalCurrency: $order->total->currency->code,
			status: $order->status->value,
			placedAt: $order->placedAt,
		);

		foreach ($order->lines() as $line) {
			$doctrine->lines->add(new DoctrineOrderLine(
				order: $doctrine,
				section: $line->section,
				rowLabel: $line->row,
				seatNumber: $line->number,
				priceTierId: $line->priceTierId,
				priceAmount: $line->price->amount,
				priceCurrency: $line->price->currency->code,
			));
		}

		return $doctrine;
	}

	public function toDomain(DoctrineOrder $row): Order
	{
		$lines = [];
		foreach ($row->lines as $line) {
			$lines[] = new OrderLine(
				section: $line->section,
				row: $line->rowLabel,
				number: $line->seatNumber,
				priceTierId: $line->priceTierId,
				price: Money::of($line->priceAmount, Currency::of($line->priceCurrency)),
			);
		}

		return Order::reconstitute(
			OrderId::fromString($row->id),
			$row->eventId,
			$row->holdId,
			$lines,
			Money::of($row->totalAmount, Currency::of($row->totalCurrency)),
			OrderStatus::from($row->status),
			$row->placedAt,
		);
	}
}
