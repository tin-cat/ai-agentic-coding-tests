<?php

declare(strict_types=1);

namespace Frontstage\Ordering\Infrastructure\Http\Controller;

use Frontstage\Ordering\Application\Bus\QueryBus;
use Frontstage\Ordering\Application\Query\GetOrder\GetOrderQuery;
use Frontstage\Ordering\Application\Query\View\OrderView;
use Symfony\Component\HttpFoundation\JsonResponse;
use Symfony\Component\HttpFoundation\Response;
use Symfony\Component\Routing\Attribute\Route;

final class GetOrderController
{
	public function __construct(private readonly QueryBus $queries)
	{
	}

	#[Route('/orders/{id}', name: 'ordering_order_get', methods: ['GET'])]
	public function __invoke(string $id): Response
	{
		/** @var OrderView $view */
		$view = $this->queries->ask(new GetOrderQuery($id));

		return new JsonResponse($view->toArray(), Response::HTTP_OK);
	}
}
