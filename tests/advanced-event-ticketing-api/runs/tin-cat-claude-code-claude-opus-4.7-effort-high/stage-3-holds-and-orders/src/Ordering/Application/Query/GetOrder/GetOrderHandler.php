<?php

declare(strict_types=1);

namespace Frontstage\Ordering\Application\Query\GetOrder;

use Frontstage\Ordering\Application\Query\OrderReadModel;
use Frontstage\Ordering\Application\Query\View\OrderView;
use Frontstage\Ordering\Domain\Exception\OrderNotFound;
use Frontstage\Ordering\Domain\Model\Order\OrderId;
use Symfony\Component\Messenger\Attribute\AsMessageHandler;

#[AsMessageHandler(bus: 'query.bus')]
final class GetOrderHandler
{
	public function __construct(private readonly OrderReadModel $orders)
	{
	}

	public function __invoke(GetOrderQuery $query): OrderView
	{
		$id = OrderId::fromString($query->orderId);
		$view = $this->orders->findById($id);

		if (null === $view) {
			throw OrderNotFound::withId($id);
		}

		return $view;
	}
}
