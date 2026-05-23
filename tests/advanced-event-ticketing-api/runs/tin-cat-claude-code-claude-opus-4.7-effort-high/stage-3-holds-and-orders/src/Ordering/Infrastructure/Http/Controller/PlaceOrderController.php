<?php

declare(strict_types=1);

namespace Frontstage\Ordering\Infrastructure\Http\Controller;

use Frontstage\Ordering\Application\Bus\CommandBus;
use Frontstage\Ordering\Application\Command\PlaceOrder\PlaceOrderCommand;
use Frontstage\Ordering\Infrastructure\Http\JsonRequest;
use Symfony\Component\HttpFoundation\JsonResponse;
use Symfony\Component\HttpFoundation\Request;
use Symfony\Component\HttpFoundation\Response;
use Symfony\Component\Routing\Attribute\Route;
use Symfony\Component\Uid\Uuid;

final class PlaceOrderController
{
	public function __construct(private readonly CommandBus $commands)
	{
	}

	#[Route('/orders', name: 'ordering_order_place', methods: ['POST'])]
	public function __invoke(Request $request): Response
	{
		$payload = JsonRequest::decode($request);

		$orderId = isset($payload['id']) && is_string($payload['id']) && '' !== $payload['id']
			? $payload['id']
			: Uuid::v7()->toRfc4122();

		$holdId = (string) ($payload['holdId'] ?? '');

		$this->commands->dispatch(new PlaceOrderCommand(
			orderId: $orderId,
			holdId: $holdId,
		));

		return new JsonResponse(['id' => $orderId], Response::HTTP_CREATED, [
			'Location' => sprintf('/orders/%s', $orderId),
		]);
	}
}
