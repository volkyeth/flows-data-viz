import { useEffect, useState } from "react";
import "./index.css";
import SankeyDiagram from "./SankeyDiagram";

interface GrantItem {
  title: string;
  status: number;
  monthlyIncomingFlowRate: string;
  monthlyOutgoingFlowRate: string;
  flowId: string | null; // ID of the source grant/node
  recipient: string;
  isFlow: boolean;
  id: string; // ID of this grant/node
}

interface ApiResponse {
  data: {
    grantss: {
      items: GrantItem[];
    };
  };
}

export function App() {
  const [items, setItems] = useState<GrantItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const fetchData = async () => {
      try {
        const response = await fetch("https://ponder-schemaonchain-production.up.railway.app/", {
          method: "POST",
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            query: `query MyQuery {
              grantss(limit: 1000, where: {isActive: true}) {
                items {
                  title
                  status
                  recipient
                  monthlyIncomingFlowRate
                  monthlyOutgoingFlowRate
                  flowId
                  isFlow
                  id
                }
              }
            }`,
            operationName: "MyQuery"
          })
        });

        if (!response.ok) {
          throw new Error(`API request failed with status ${response.status}`);
        }

        const responseData: ApiResponse = await response.json();
        setItems(responseData.data.grantss.items);
      } catch (err) {
        setError(err instanceof Error ? err.message : "An unknown error occurred");
      } finally {
        setLoading(false);
      }
    };

    fetchData();
  }, []);

  return (
    <div className="min-h-screen flex flex-col">
      {loading && (
        <div className="flex-1 flex items-center justify-center">
          <p className="text-lg">Loading grant data...</p>
        </div>
      )}
      
      {error && (
        <div className="flex-1 flex items-center justify-center">
          <p className="text-lg text-red-600">Error: {error}</p>
        </div>
      )}
      
      {!loading && !error && items.length > 0 && (
        <div className="flex-1 flex flex-col">
          <h1 className="text-2xl font-bold p-4 text-center">Flows distribution</h1>
        
            <SankeyDiagram items={items} />

        </div>
      )}

      {!loading && !error && items.length === 0 && (
        <div className="flex-1 flex items-center justify-center">
          <p className="text-lg">No grant data available.</p>
        </div>
      )}
    </div>
  );
}

export default App;
